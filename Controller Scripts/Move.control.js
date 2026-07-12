/// <reference path="./bitwig-api.d.ts" />

/**
 * Move.control.js
 * Main Entry Point for Bitwig Move Controller (protocol v2, sysex).
 *
 * Modes: SESSION (pads = clip launcher, steps = track select/stop) and
 * NOTE (pads = playable notes, steps = step sequencer). Menu toggles.
 */

loadAPI(18);
host.setShouldFailOnDeprecatedUse(true);

host.defineController("Ableton", "Move", "0.3", "7bc8983f-638b-40ab-8c23-95f4c8697cab", "soße");
host.defineMidiPorts(1, 1);
host.addDeviceNameBasedDiscoveryPair(["Ableton Move"], ["Ableton Move"]);

// Load modules
load("MoveHardware.js");
load("MoveProtocol.js");
load("MoveTransport.js");
load("MoveGrid.js");
load("MoveNavigation.js");
load("MoveTrackControls.js");
load("MoveNotes.js");

// Global states
var midiIn = null;
var midiOut = null;

// UI mode: "session" | "note"
var ui = { mode: "session" };

// Held-modifier state, shared with all handler modules.
var modifiers = {
    shift: false,
    del: false,
    copy: false,
    mute: false,     // managed by MoveTrackControls (tap-vs-hold)
    muteUsed: false  // set by any handler that consumes Mute as a modifier
};

// Blink phase for queued clips (~3 Hz)
var blinkPhase = false;

function init() {
    midiIn = host.getMidiInPort(0);
    midiOut = host.getMidiOutPort(0);

    midiIn.setMidiCallback(onMidi0);
    midiIn.setSysexCallback(onSysex0);

    // Protocol first (handshake), then feature modules.
    MoveProtocol.init(midiOut);
    MoveTransport.init(host);
    MoveNavigation.init(host); // creates trackBank/cursorTrack (+ shared observers)
    MoveGrid.init(host, MoveNavigation.trackBank);
    MoveTrackControls.init(host, MoveNavigation.cursorTrack,
        MoveNavigation.trackBank.sceneBank(), MoveNavigation.trackBank);
    MoveNotes.init(host, midiIn, MoveNavigation.cursorTrack, MoveNavigation.cursorDevice);

    MoveProtocol.text(1, "Bitwig Move");
    MoveProtocol.text(2, "Initialized");

    blinkLoop();
    println("Bitwig Move Initialized (protocol v2)");
}

function blinkLoop() {
    blinkPhase = !blinkPhase;
    host.requestFlush();
    host.scheduleTask(blinkLoop, 300);
}

function setMode(mode) {
    ui.mode = mode;
    MoveNotes.setActive(mode === "note");
    MoveNavigation.toast(mode === "note"
        ? (MoveNotes.drumMode ? "NOTE mode (drum)" : "NOTE mode")
        : "SESSION mode");
    host.requestFlush();
}

function onMidi0(status, data1, data2) {
    var msgType = status & 0xF0;

    // 1. Track held modifiers globally
    if (msgType === 0xB0) {
        switch (data1) {
            case MoveHardware.CC.SHIFT:
                modifiers.shift = (data2 > 64);
                return;
            case MoveHardware.CC.DELETE:
                modifiers.del = (data2 > 64);
                return;
            case MoveHardware.CC.COPY:
                modifiers.copy = (data2 > 64);
                return;
            case MoveHardware.CC.MENU:
                if (data2 === 127) setMode(ui.mode === "session" ? "note" : "session");
                return;
        }
    }

    // 2. CC handlers (Transport, Track Controls, Notes (note mode), Navigation)
    if (msgType === 0xB0) {
        if (MoveTransport.handleCC(data1, data2, modifiers)) return;
        if (MoveTrackControls.handleCC(data1, data2, modifiers)) return;
        if (ui.mode === "note" && MoveNotes.handleCC(data1, data2, modifiers)) return;
        if (MoveNavigation.handleCC(data1, data2, modifiers)) return;
    }

    // 3. Note handlers (Knob touch, Shift+Step settings, then Grid or Notes)
    if (msgType === 0x90 || msgType === 0x80) {
        if (data1 <= 9) {
            if (MoveNavigation.handleTouch(status, data1, data2, modifiers)) return;
        }
        if (modifiers.shift
            && data1 >= MoveHardware.NOTES.STEP_FIRST && data1 <= MoveHardware.NOTES.STEP_LAST) {
            if (msgType === 0x90 && data2 > 0) {
                handleShiftStep(data1 - MoveHardware.NOTES.STEP_FIRST);
            }
            return; // consume both press and release
        }
        if (ui.mode === "note") {
            if (MoveNotes.handleNote(status, data1, data2, modifiers)) return;
        } else {
            if (MoveGrid.handleNote(status, data1, data2, modifiers)) return;
        }
    }

    // println("Unhandled MIDI: " + status + " " + data1 + " " + data2);
}

/**
 * Shift+Step settings/actions (manual parity, SPEC §5.7).
 * stepIdx is 0-based (Step 1 = 0).
 */
function handleShiftStep(stepIdx) {
    switch (stepIdx) {
        case 5: // Step 6: metronome
            MoveTransport.transport.isMetronomeEnabled().toggle();
            MoveNavigation.toast("Metronome");
            break;
        case 9: // Step 10: full velocity
            var on = MoveNotes.toggleFullVelocity();
            MoveNavigation.toast("Full velocity " + (on ? "ON" : "OFF"));
            break;
        case 14: // Step 15: double clip content
            if (MoveNotes.cursorClip.exists().get()) {
                MoveNotes.cursorClip.duplicateContent();
                MoveNavigation.toast("Content doubled");
            } else {
                MoveNavigation.toast("No clip selected");
            }
            break;
        case 15: // Step 16: quantize clip
            if (MoveNotes.cursorClip.exists().get()) {
                MoveNotes.cursorClip.quantize(1.0);
                MoveNavigation.toast("Quantized");
            } else {
                MoveNavigation.toast("No clip selected");
            }
            break;
    }
}

function onSysex0(data) {
    if (MoveProtocol.onSysex(data)) return;
    // Other sysex ignored.
}

function flush() {
    // Modules write desired LED/text state into MoveProtocol caches...
    MoveTransport.updateLEDs();
    if (ui.mode === "note") {
        MoveNotes.updateLEDs();
    } else {
        MoveGrid.updateLEDs(blinkPhase);
    }
    MoveTrackControls.updateLEDs();
    MoveNavigation.updateLEDs();
    MoveNavigation.updateDisplay();
    // Menu button LED shows the mode (lit = NOTE mode)
    MoveProtocol.ledCC(MoveHardware.CC.MENU, ui.mode === "note" ? 127 : 0);
    // ...and one flush sends only the diffs.
    MoveProtocol.flush();
}

function exit() {
    println("Bitwig Move Controller Exited.");
}
