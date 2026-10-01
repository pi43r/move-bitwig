/// <reference path="./bitwig-api.d.ts" />

/**
 * Move.control.js
 * Main Entry Point for Bitwig Move Controller (protocol v2, sysex).
 *
 * Menu switches Session/Note; Shift+Menu opens Mixer.
 * Capture is the Device modifier.
 */

loadAPI(25);
host.setShouldFailOnDeprecatedUse(true);

host.defineController("Ableton", "Move", "1.0.0", "7bc8983f-638b-40ab-8c23-95f4c8697cab", "soße");
host.defineMidiPorts(1, 1);
host.addDeviceNameBasedDiscoveryPair(["Ableton Move (Standalone Port)"], ["Ableton Move (Standalone Port)"]);
host.addDeviceNameBasedDiscoveryPair(["Ableton Move"], ["Ableton Move"]);

// Load modules
load("MoveHardware.js");
load("MoveProtocol.js");
load("MoveTransport.js");
load("MoveGrid.js");
load("MoveSceneStop.js");
load("MoveMixer.js");
load("MoveNavigation.js");
load("MoveLastTouched.js");
load("MoveTrackControls.js");
load("MoveNotes.js");
load("MoveDrumMods.js");
load("MoveSequencer.js");
load("MoveWorkflow.js");
load("MoveFeedback.js");
load("MoveScreen.js");
load("MoveBrowser.js");

// Global states
var midiIn = null;
var midiOut = null;

// UI mode: "session" | "note" | "mixer"
var ui = { mode: "session" };
var MODE_CYCLE = ["session", "note"];

// Held-modifier state, shared with all handler modules.
var modifiers = {
    shift: false,
    device: false,
    del: false,
    copy: false,
    mute: false,     // managed by MoveTrackControls (tap-vs-hold)
    muteUsed: false, // set by any handler that consumes Mute as a modifier
    loop: false,     // Loop button held (tap-vs-hold, like Mute)
    loopUsed: false  // set by any handler that consumes Loop as a modifier
};

// Blink phase for queued clips (~3 Hz)
var blinkPhase = false;

// Quantize amount used by Shift+Step 16 (edited in Workflow).
var quantizeAmount = 1.0;
// Remember shortcut presses so their releases cannot become step edits.
var shiftedSteps = {};

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
    MoveTrackControls.init(host, MoveNavigation.cursorTrack, MoveNavigation.trackBank);
    MoveDrumMods.init();
    MoveNotes.init(host, midiIn, MoveNavigation.cursorTrack, MoveNavigation.instrumentDevice);
    MoveBrowser.init(host, MoveNavigation.cursorTrack, MoveNavigation.cursorDevice);
    MoveFeedback.init(host);

    MoveScreen.frame("SESSION", "Bitwig Move", "Initialized", "");

    blinkLoop();
    println("Bitwig Move Initialized (protocol v2)");
}

function blinkLoop() {
    blinkPhase = !blinkPhase;
    host.requestFlush();
    host.scheduleTask(blinkLoop, 300);
}

function setMode(mode) {
    MoveWorkflow.screen = null;
    MoveTrackControls.heldTrack = -1;
    MoveGrid.heldTrack = -1;
    ui.mode = mode;
    MoveNotes.setActive(mode === "note");
    if (mode === "note") {
        MoveFeedback.showClip();
        MoveScreen.announce(MoveNotes.drumMode ? "Drums" : "Notes", MoveNotes.drumMode ? "DRUM" : "NOTE");
    } else if (mode === "mixer") MoveScreen.announce("Mixer", "MIX");
    else MoveScreen.announce("Session", "SESSION");
    host.requestFlush();
}

function onMidi0(status, data1, data2) {
    var msgType = status & 0xF0;

    // 1. Track held modifiers globally
    if (msgType === 0xB0) {
        switch (data1) {
            case MoveHardware.CC.SHIFT:
                if (data2 > 64 && !modifiers.shift) modifiers.shiftSince = Date.now();
                modifiers.shift = (data2 > 64);
                host.requestFlush(); // step LEDs show Shift+Step functions
                return;
            case MoveHardware.CC.CAPTURE:
                modifiers.device = data2 > 64;
                MoveNotes.cancelStepGesture();
                host.requestFlush();
                return;
            case MoveHardware.CC.DELETE:
                modifiers.del = (data2 > 64);
                host.requestFlush();
                return;
            case MoveHardware.CC.COPY:
                modifiers.copy = (data2 > 64);
                host.requestFlush();
                if (!modifiers.copy) {
                    // Release abandons a pending Copy+Pad gesture
                    MoveGrid.copySource = null;
                }
                // Loop held + Copy = double the clip content (Move-style)
                if (modifiers.copy && modifiers.loop) {
                    modifiers.loopUsed = true;
                    if (MoveSequencer.hasClip()) {
                        MoveNotes.cursorClip.duplicateContent();
                        MoveNavigation.toast("Content doubled");
                    } else {
                        MoveNavigation.toast("No clip selected");
                    }
                }
                return;
            case MoveHardware.CC.LOOP:
                MoveNotes.cancelStepGesture();
                MoveNotes.loopAnchorStep = -1;
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
                        setMode("mixer");
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
        if (modifiers.device && MoveNavigation.handleDeviceCC(data1, data2, modifiers)) return;
        if (MoveWorkflow.handleCC(data1, data2, modifiers)) return;
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
        if (data1 >= MoveHardware.NOTES.STEP_FIRST && data1 <= MoveHardware.NOTES.STEP_LAST) {
            var stepPress = msgType === 0x90 && data2 > 0;
            if (!stepPress && shiftedSteps[data1]) {
                delete shiftedSteps[data1];
                return;
            }
            if (stepPress && modifiers.shift) {
                shiftedSteps[data1] = true;
                MoveWorkflow.handleShiftStep(data1 - MoveHardware.NOTES.STEP_FIRST);
                return;
            }
            if (MoveWorkflow.screen) return;
        }
        if (ui.mode === "note") {
            if (MoveNotes.handleNote(status, data1, data2, modifiers)) return;
        } else if (ui.mode === "mixer") {
            if (MoveMixer.handleNote(status, data1, data2, modifiers)) return;
            if (MoveGrid.handleNote(status, data1, data2, modifiers)) return;
        } else {
            if (MoveGrid.handleNote(status, data1, data2, modifiers)) return;
        }
    }

}

function onSysex0(data) {
    if (MoveProtocol.onSysex(data)) return;
    // Other sysex ignored.
}

function flush() {
    MoveLastTouched.sync();
    MoveSequencer.sync();
    MoveNotes.flushPendingNotes();
    MoveFeedback.updateIndications();
    // Modules write desired LED/text state into MoveProtocol caches...
    MoveTransport.updateLEDs();
    if (ui.mode === "note") {
        MoveNotes.updateLEDs();
        if (modifiers.loop && !modifiers.shift) MoveNotes.updateLoopStepLEDs();
    } else if (ui.mode === "mixer") {
        MoveMixer.updatePadLEDs();
        MoveGrid.updateStepLEDs();
    } else {
        MoveGrid.updateLEDs(blinkPhase);
    }
    // Icon row below the steps (CC 16-31): Shift+Step function map while
    // Shift is held, dark otherwise
    MoveWorkflow.updateShiftStepLEDs();
    MoveTrackControls.updateLEDs();
    if (ui.mode === "mixer") MoveMixer.updateKnobLEDs();
    else MoveNavigation.updateLEDs();
    MoveProtocol.sequence(null);
    if (MoveBrowser.isOpen()) {
        MoveBrowser.updateDisplay();
    } else if (MoveWorkflow.screen) {
        MoveWorkflow.updateDisplay();
    } else if (ui.mode === "note" && MoveNotes.overlayActive) {
        MoveNotes.updateOverlayDisplay();
    } else {
        var showSequence = MoveScreen.update();
        // Note/Drum screens end with the clip's bar overview
        if (showSequence) MoveProtocol.sequence(MoveSequencer.overview());
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
