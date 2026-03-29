/// <reference path="./bitwig-api.d.ts" />

/**
 * Move.control.js
 * Main Entry Point for Bitwig Move Controller.
 */


loadAPI(18);
host.setShouldFailOnDeprecatedUse(true);

host.defineController("Ableton", "Move", "0.1", "7bc8983f-638b-40ab-8c23-95f4c8697cab", "soße");
host.defineMidiPorts(1, 1);
if (host.platformIsWindows()) {
    host.addDeviceNameBasedDiscoveryPair(["Ableton Move"], ["Ableton Move"]);
} else if (host.platformIsMac()) {
    host.addDeviceNameBasedDiscoveryPair(["Ableton Move"], ["Ableton Move"]);
}

// Load modules
load("MoveHardware.js");
load("MoveDisplay.js");
load("MoveTransport.js");
load("MoveGrid.js");
load("MoveNavigation.js");
load("MoveTrackControls.js");

// Global states
var midiIn = null;
var midiOut = null;
var shiftDown = false;

function init() {
    // MIDI Configuration
    midiIn = host.getMidiInPort(0);
    midiOut = host.getMidiOutPort(0);

    midiIn.setMidiCallback(onMidi0);
    midiIn.setSysexCallback(onSysex0);

    // Initialize Modules in order
    MoveTransport.init(host);
    MoveNavigation.init(host); // Navigation creates trackBank/cursorTrack
    MoveGrid.init(host, MoveNavigation.trackBank);
    MoveTrackControls.init(host, MoveNavigation.cursorTrack, MoveNavigation.trackBank.sceneBank());

    // Initial Display Update
    MoveDisplay.sendText(1, "Bitwig Move", midiOut);
    MoveDisplay.sendText(2, "Initialized", midiOut);
    MoveDisplay.commit(midiOut);

    println("Bitwig Move Initialized!");
}

function onMidi0(status, data1, data2) {
    var msgType = status & 0xF0;

    // 1. Handle Shift key globally (CC 49)
    if (msgType === 0xB0 && data1 === MoveHardware.CC.SHIFT) {
        shiftDown = (data2 > 64);
        return;
    }

    // 2. Delegate to CC handlers (Transport, Track Controls, Navigation)
    if (msgType === 0xB0) {
        if (MoveTransport.handleCC(data1, data2)) return;
        if (MoveTrackControls.handleCC(data1, data2, shiftDown)) return;
        if (MoveNavigation.handleCC(data1, data2, shiftDown)) return;
    }

    // 3. Delegate to Note handlers (Grid, Knob Touch)
    if (msgType === 0x90 || msgType === 0x80) {
        // Knob touches use low notes 0-9
        if (data1 >= 0 && data1 <= 9) {
            if (MoveNavigation.handleTouch(status, data1, data2)) return;
        }
        // Grid pads
        if (MoveGrid.handleNote(status, data1, data2, shiftDown)) return;
    }

    // println("Unhandled MIDI: " + status + " " + data1 + " " + data2);
}

function onSysex0(data) {
    // Sysex handling if needed
}

function flush() {
    // Update LEDs and Display from modules
    MoveTransport.updateLEDs(midiOut);
    MoveGrid.updateLEDs(midiOut);
    MoveTrackControls.updateLEDs(midiOut);
    MoveNavigation.updateDisplay(midiOut);
}

function exit() {
    println("Bitwig Move Controller Exited.");
}