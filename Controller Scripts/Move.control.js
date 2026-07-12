/// <reference path="./bitwig-api.d.ts" />

/**
 * Move.control.js
 * Main Entry Point for Bitwig Move Controller (protocol v2, sysex).
 */

loadAPI(18);
host.setShouldFailOnDeprecatedUse(true);

host.defineController("Ableton", "Move", "0.2", "7bc8983f-638b-40ab-8c23-95f4c8697cab", "soße");
host.defineMidiPorts(1, 1);
host.addDeviceNameBasedDiscoveryPair(["Ableton Move"], ["Ableton Move"]);

// Load modules
load("MoveHardware.js");
load("MoveProtocol.js");
load("MoveTransport.js");
load("MoveGrid.js");
load("MoveNavigation.js");
load("MoveTrackControls.js");

// Global states
var midiIn = null;
var midiOut = null;

// Held-modifier state, shared with all handler modules.
var modifiers = {
    shift: false,
    del: false,
    copy: false,
    mute: false
};

function init() {
    midiIn = host.getMidiInPort(0);
    midiOut = host.getMidiOutPort(0);

    midiIn.setMidiCallback(onMidi0);
    midiIn.setSysexCallback(onSysex0);

    // Protocol first (handshake), then feature modules.
    MoveProtocol.init(midiOut);
    MoveTransport.init(host);
    MoveNavigation.init(host); // creates trackBank/cursorTrack
    MoveGrid.init(host, MoveNavigation.trackBank);
    MoveTrackControls.init(host, MoveNavigation.cursorTrack, MoveNavigation.trackBank.sceneBank());

    MoveProtocol.text(1, "Bitwig Move");
    MoveProtocol.text(2, "Initialized");

    println("Bitwig Move Initialized (protocol v2)");
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
            // NOTE: Mute stays an action button for now (toggle mute);
            // it becomes a held modifier in the track-gesture phase.
        }
    }

    // 2. CC handlers (Transport, Track Controls, Navigation)
    if (msgType === 0xB0) {
        if (MoveTransport.handleCC(data1, data2, modifiers)) return;
        if (MoveTrackControls.handleCC(data1, data2, modifiers)) return;
        if (MoveNavigation.handleCC(data1, data2, modifiers)) return;
    }

    // 3. Note handlers (Knob touch, Grid)
    if (msgType === 0x90 || msgType === 0x80) {
        if (data1 <= 9) {
            if (MoveNavigation.handleTouch(status, data1, data2)) return;
        }
        if (MoveGrid.handleNote(status, data1, data2, modifiers)) return;
    }

    // println("Unhandled MIDI: " + status + " " + data1 + " " + data2);
}

function onSysex0(data) {
    if (MoveProtocol.onSysex(data)) return;
    // Other sysex ignored.
}

function flush() {
    // Modules write desired LED/text state into MoveProtocol caches...
    MoveTransport.updateLEDs();
    MoveGrid.updateLEDs();
    MoveTrackControls.updateLEDs();
    MoveNavigation.updateDisplay();
    // ...and one flush sends only the diffs.
    MoveProtocol.flush();
}

function exit() {
    println("Bitwig Move Controller Exited.");
}
