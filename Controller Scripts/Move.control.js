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

    // Initial Display Update
    MoveDisplay.sendText(1, "Bitwig Move", midiOut);
    MoveDisplay.sendText(2, "Initialized", midiOut);
    MoveDisplay.commit(midiOut);

    println("Bitwig Move Initialized!");
}

function onMidi0(status, data1, data2) {
    // 1. Handle Shift key globally
    if (data1 === MoveHardware.CC.SHIFT) {
        shiftDown = (data2 > 64);
        return;
    }

    // 2. Delegate to Transport
    if (MoveTransport.handleCC(data1, data2)) return;

    // 3. Delegate to Grid (Pads) or Navigation (Touch)
    if (data1 >= 0 && data1 <= 7) {
        if (MoveNavigation.handleTouch(status, data1, data2)) return;
    }
    if (MoveGrid.handleNote(status, data1, data2)) return;

    // 4. Delegate to Navigation (Arrows, Knobs, Selection)
    if (MoveNavigation.handleCC(data1, data2, shiftDown)) return;

    // println("Unhandled MIDI: " + status + " " + data1 + " " + data2);
}

function onSysex0(data) {
    // Sysex handling if needed
}

function flush() {
    // Update LEDs and Display from modules
    MoveTransport.updateLEDs(midiOut);
    MoveGrid.updateLEDs(midiOut);
    MoveNavigation.updateDisplay(midiOut);
}

function exit() {
    println("Bitwig Move Controller Exited.");
}