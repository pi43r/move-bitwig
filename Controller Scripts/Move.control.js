/// <reference path="./bitwig-api.d.ts" />

/**
 * Move.control.js
 * Main Entry Point for Bitwig Move Controller (protocol v2, sysex).
 *
 * Modes (Menu cycles): SESSION (pads = clip launcher, steps = track
 * select/stop), NOTE (pads = playable notes, steps = step sequencer),
 * MIXER (knobs = volumes, pad rows = arm/solo/mute/select).
 * Shift+Menu = Session Overview (pads jump the 8x4 window).
 */

loadAPI(18);
host.setShouldFailOnDeprecatedUse(true);

host.defineController("Ableton", "Move", "0.6", "7bc8983f-638b-40ab-8c23-95f4c8697cab", "soße");
host.defineMidiPorts(1, 1);
host.addDeviceNameBasedDiscoveryPair(["Ableton Move"], ["Ableton Move"]);

// Load modules
load("MoveHardware.js");
load("MoveProtocol.js");
load("MoveTransport.js");
load("MoveGrid.js");
load("MoveMixer.js");
load("MoveNavigation.js");
load("MoveTrackControls.js");
load("MoveNotes.js");
load("MoveBrowser.js");

// Global states
var midiIn = null;
var midiOut = null;

// UI mode: "session" | "note" | "mixer" (+ Session Overview sub-mode)
var ui = { mode: "session", overview: false };
var MODE_CYCLE = ["session", "note", "mixer"];

// Held-modifier state, shared with all handler modules.
var modifiers = {
    shift: false,
    del: false,
    copy: false,
    mute: false,     // managed by MoveTrackControls (tap-vs-hold)
    muteUsed: false, // set by any handler that consumes Mute as a modifier
    loop: false,     // Loop button held (tap-vs-hold, like Mute)
    loopUsed: false  // set by any handler that consumes Loop as a modifier
};

// Blink phase for queued clips (~3 Hz)
var blinkPhase = false;

// Quantize amount used by Shift+Step 16 (cycled with Shift+Step 3)
var quantizeAmount = 1.0;

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
    MoveMixer.init(host, MoveNavigation.trackBank);
    MoveTrackControls.init(host, MoveNavigation.cursorTrack,
        MoveNavigation.trackBank.sceneBank(), MoveNavigation.trackBank);
    MoveNotes.init(host, midiIn, MoveNavigation.cursorTrack, MoveNavigation.cursorDevice);
    MoveBrowser.init(host, MoveNavigation.cursorTrack, MoveNavigation.cursorDevice);

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
    ui.overview = false;
    MoveNotes.setActive(mode === "note");
    var label = "SESSION mode";
    if (mode === "note") label = MoveNotes.drumMode ? "NOTE mode (drum)" : "NOTE mode";
    else if (mode === "mixer") label = "MIXER mode";
    MoveNavigation.toast(label);
    host.requestFlush();
}

function onMidi0(status, data1, data2) {
    var msgType = status & 0xF0;

    // 1. Track held modifiers globally
    if (msgType === 0xB0) {
        switch (data1) {
            case MoveHardware.CC.SHIFT:
                modifiers.shift = (data2 > 64);
                host.requestFlush(); // step LEDs show Shift+Step functions
                return;
            case MoveHardware.CC.DELETE:
                modifiers.del = (data2 > 64);
                return;
            case MoveHardware.CC.COPY:
                modifiers.copy = (data2 > 64);
                if (!modifiers.copy) {
                    // Release abandons a pending Copy+Pad gesture
                    MoveGrid.copySource = null;
                }
                // Loop held + Copy = double the clip content (Move-style)
                if (modifiers.copy && modifiers.loop) {
                    modifiers.loopUsed = true;
                    if (MoveNotes.cursorClip.exists().get()) {
                        MoveNotes.cursorClip.duplicateContent();
                        MoveNavigation.toast("Content doubled");
                    } else {
                        MoveNavigation.toast("No clip selected");
                    }
                }
                return;
            case MoveHardware.CC.LOOP:
                // Hold = modifier (loop-length gestures); tap = arranger loop.
                if (data2 > 64) {
                    modifiers.loop = true;
                    modifiers.loopUsed = false;
                } else {
                    modifiers.loop = false;
                    if (!modifiers.loopUsed) MoveTransport.toggleArrangerLoop();
                }
                host.requestFlush(); // step LEDs show Loop Mode bars
                return;
            case MoveHardware.CC.MENU:
                if (data2 === 127) {
                    if (modifiers.shift) {
                        // Shift+Menu: Session Overview (in SESSION mode)
                        if (ui.mode !== "session") setMode("session");
                        ui.overview = !ui.overview;
                        MoveNavigation.toast(ui.overview ? "Session Overview" : "Session");
                        host.requestFlush();
                    } else {
                        var next = (MODE_CYCLE.indexOf(ui.mode) + 1) % MODE_CYCLE.length;
                        setMode(MODE_CYCLE[next]);
                    }
                }
                return;
        }
    }

    // 2. CC handlers (browser, overlay, Transport, Track Controls, mode
    //    module, Navigation)
    if (msgType === 0xB0) {
        if (MoveBrowser.isOpen()
            && MoveBrowser.handleCC(data1, data2, modifiers)) return;
        if (ui.mode === "note" && MoveNotes.overlayActive
            && MoveNotes.handleOverlayCC(data1, data2)) return;
        if (MoveTransport.handleCC(data1, data2, modifiers)) return;
        if (MoveTrackControls.handleCC(data1, data2, modifiers)) return;
        if (ui.mode === "note" && MoveNotes.handleCC(data1, data2, modifiers)) return;
        if (ui.mode === "mixer" && MoveMixer.handleCC(data1, data2, modifiers)) return;
        if (MoveNavigation.handleCC(data1, data2, modifiers)) return;
    }

    // 3. Note handlers (Knob touch, Shift+Step settings, then the mode module)
    if (msgType === 0x90 || msgType === 0x80) {
        if (data1 <= 9) {
            if (MoveNavigation.handleTouch(status, data1, data2, modifiers,
                ui.mode === "mixer")) return;
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
        } else if (ui.mode === "mixer") {
            if (MoveMixer.handleNote(status, data1, data2, modifiers)) return;
            if (MoveGrid.handleNote(status, data1, data2, modifiers, false)) return;
        } else {
            var wasOverviewPad = ui.overview && msgType === 0x90 && data2 > 0
                && data1 >= MoveHardware.NOTES.PAD_FIRST
                && data1 <= MoveHardware.NOTES.PAD_LAST;
            if (MoveGrid.handleNote(status, data1, data2, modifiers, ui.overview)) {
                if (wasOverviewPad) ui.overview = false; // block chosen: back to session
                return;
            }
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
        case 2: // Step 3: quantize amount (used by Shift+Step 16)
            quantizeAmount = quantizeAmount >= 1.0 ? 0.5
                : (quantizeAmount === 0.5 ? 0.75 : 1.0);
            MoveNavigation.toast("Quantize " + Math.round(quantizeAmount * 100) + "%");
            break;
        case 5: // Step 6: metronome
            MoveTransport.transport.isMetronomeEnabled().toggle();
            MoveNavigation.toast("Metronome");
            break;
        case 6: // Step 7: global groove
            var grooveOn = MoveTransport.toggleGroove();
            MoveNavigation.toast("Groove " + (grooveOn ? "ON" : "OFF"));
            break;
        case 8: // Step 9: Key & Scale overlay (NOTE mode)
            if (ui.mode !== "note") {
                MoveNavigation.toast("Scale: NOTE mode only");
            } else {
                MoveNotes.overlayActive = !MoveNotes.overlayActive;
                host.requestFlush();
            }
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
                MoveNotes.cursorClip.quantize(quantizeAmount);
                MoveNavigation.toast("Quantized " + Math.round(quantizeAmount * 100) + "%");
            } else {
                MoveNavigation.toast("No clip selected");
            }
            break;
    }
}

/**
 * Icon LEDs below the step buttons (CC 16-31, one per step — the row schwung
 * itself uses for the Settings/Tools icons). While Shift is held they show
 * the Shift+Step function map: dim white = has a function, green = the
 * toggle is currently on. Dark when Shift is up. Mirrors handleShiftStep.
 */
function updateShiftStepLEDs() {
    var C = MoveHardware.COLOR;
    var colors = {};
    if (modifiers.shift) {
        colors[2] = C.WHITE;                                       // quantize amount
        colors[5] = MoveTransport.transport.isMetronomeEnabled().get()
            ? C.GREEN : C.HAS_CLIP;                                // metronome
        colors[6] = (MoveTransport.groove.getEnabled().get() > 0.5)
            ? C.GREEN : C.HAS_CLIP;                                // groove
        if (ui.mode === "note") {
            colors[8] = MoveNotes.overlayActive ? C.GREEN : C.HAS_CLIP; // scale overlay
        }
        colors[9] = MoveNotes.fullVelocity ? C.GREEN : C.HAS_CLIP; // full velocity
        colors[14] = C.HAS_CLIP;                                   // double content
        colors[15] = C.HAS_CLIP;                                   // quantize clip
    }
    for (var i = 0; i < 16; i++) {
        MoveProtocol.ledCC(16 + i,
            colors[i] !== undefined ? colors[i] : C.BLACK);
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
        if (modifiers.loop && !modifiers.shift) MoveNotes.updateLoopStepLEDs();
    } else if (ui.mode === "mixer") {
        MoveMixer.updatePadLEDs();
        MoveGrid.updateStepLEDs();
    } else {
        MoveGrid.updateLEDs(blinkPhase, ui.overview);
    }
    // Icon row below the steps (CC 16-31): Shift+Step function map while
    // Shift is held, dark otherwise
    updateShiftStepLEDs();
    MoveTrackControls.updateLEDs();
    if (ui.mode === "mixer") MoveMixer.updateKnobLEDs();
    else MoveNavigation.updateLEDs();
    if (MoveBrowser.isOpen()) {
        MoveBrowser.updateDisplay();
    } else if (ui.mode === "note" && MoveNotes.overlayActive) {
        MoveNotes.updateOverlayDisplay();
    } else {
        MoveNavigation.updateDisplay();
    }
    // Menu button LED shows the mode (bright = NOTE, dim = MIXER)
    var menuLed = 0;
    if (ui.mode === "note") menuLed = 127;
    else if (ui.mode === "mixer") menuLed = 32;
    MoveProtocol.ledCC(MoveHardware.CC.MENU, menuLed);
    // Loop button LED follows the arranger loop
    MoveProtocol.ledCC(MoveHardware.CC.LOOP,
        MoveTransport.transport.isArrangerLoopEnabled().get() ? 127 : 0);
    // ...and one flush sends only the diffs.
    MoveProtocol.flush();
}

function exit() {
    println("Bitwig Move Controller Exited.");
}
