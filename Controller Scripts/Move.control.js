/// <reference path="./bitwig-api.d.ts" />

loadAPI(25);
host.setShouldFailOnDeprecatedUse(true);

host.defineController("Ableton", "Move", "0.1", "7bc8983f-638b-40ab-8c23-95f4c8697cab", "soße");
host.defineMidiPorts(1, 1);
if (host.platformIsWindows()) {
    host.addDeviceNameBasedDiscoveryPair(["Ableton Move"], ["Ableton Move"]);
} else if (host.platformIsMac()) {
    host.addDeviceNameBasedDiscoveryPair(["Ableton Move"], ["Ableton Move"]);
}

var transport;
var trackBank;
var cursorTrack;
var cursorDevice;
var remoteControls;
var midiOut;

// Move hardware CC constants (matching schwung constants.mjs)
var MOVE_PLAY = 85;
var MOVE_REC = 86;
var MOVE_SHIFT = 49;
var MOVE_LEFT = 62;
var MOVE_RIGHT = 63;
var MOVE_UP = 55;
var MOVE_DOWN = 54;
var MOVE_JOG = 14;
var MOVE_MASTER = 79;

// Knob CC range: 71-78 (raw relative: 1-63 CW, 64-127 CCW)
var CC_KNOB_FIRST = 71;
var CC_KNOB_LAST = 78;

// Capacitive touch notes: 0-7
var TOUCH_KNOB_FIRST = 0;
var TOUCH_KNOB_LAST = 7;

// LED colors (MIDI note velocity values)
var COLOR_EMPTY = 0;
var COLOR_HAS_CLIP = 30;   // dim white
var COLOR_PLAYING = 8;    // green
var COLOR_GREEN = 8;    // alias
var COLOR_RECORDING = 127;  // red
var COLOR_RED = 127;  // alias
var COLOR_QUEUED = 64;   // amber

// Relative encoder resolution — must match Bitwig parameter resolution
var ENCODER_RESOLUTION = 128;

// UI State
var shiftDown = false;

// CC Text
var CC_TEXT_BASE = 110;
var CC_COMMIT = 114;

function sendTextCC(line, text) {
    if (text == null) text = "";

    var cc = CC_TEXT_BASE + (line - 1);

    midiOut.sendMidi(0xB0, cc, 1);

    for (var i = 0; i < text.length; i++) {
        var charCode = text.charCodeAt(i);
        if (charCode > 127) charCode = 63; // '?'
        midiOut.sendMidi(0xB0, cc, charCode);
    }

    // Null terminator
    midiOut.sendMidi(0xB0, cc, 0);
}

function commitText() {
    midiOut.sendMidi(0xB0, CC_COMMIT, 1);
}

/** Decode Move's relative encoder value into a signed integer delta */
function decodeDelta(value) {
    if (value === 0) return 0;
    return value <= 63 ? value : value - 128;
}

function init() {
    transport = host.createTransport();
    transport.isPlaying().markInterested();
    transport.isArrangerRecordEnabled().markInterested();

    var midiIn = host.getMidiInPort(0);
    midiOut = host.getMidiOutPort(0);
    midiIn.setMidiCallback(onMidi0);
    midiIn.setSysexCallback(onSysex0);

    // 8 tracks, 2 sends, 4 scenes
    trackBank = host.createMainTrackBank(8, 2, 4);
    cursorTrack = host.createCursorTrack(0, 0);
    cursorDevice = cursorTrack.createCursorDevice();
    remoteControls = cursorDevice.createCursorRemoteControlsPage(8);

    // Track bank observers
    trackBank.canScrollBackwards().markInterested();
    trackBank.canScrollForwards().markInterested();

    for (var i = 0; i < 8; i++) {
        var track = trackBank.getItemAt(i);
        track.name().markInterested();
        track.exists().markInterested();
        track.isQueuedForStop().markInterested();
        track.isStopped().markInterested();

        var clipLauncher = track.clipLauncherSlotBank();

        for (var j = 0; j < 4; j++) {
            var slot = clipLauncher.getItemAt(j);
            slot.hasContent().markInterested();
            slot.isPlaying().markInterested();
            slot.isRecording().markInterested();
            slot.isPlaybackQueued().markInterested();
            slot.isRecordingQueued().markInterested();
            slot.color().markInterested();
        }
    }

    // Remote Controls
    for (var i = 0; i < 8; i++) {
        var rc = remoteControls.getParameter(i);
        rc.name().markInterested();
        rc.value().markInterested();
        rc.value().displayedValue().markInterested();
        rc.setIndication(true);
    }

    cursorDevice.name().markInterested();

    println("Bitwig Move Controller Initialized!");

    // Enable clip launcher selection rectangle
    trackBank.setShouldShowClipLauncherFeedback(true);

    // Send initial text for display
    sendTextCC(1, "Bitwig Move");
    sendTextCC(2, "Connected!");
    commitText();
}

/*
function sendSysExText(line, text) {
    if (text == null) text = "";
    var hex = "F07D0" + line.toString();
    for (var i = 0; i < text.length; i++) {
        var charCode = text.charCodeAt(i);
        if (charCode > 127) charCode = 63; // '?'
        var h = charCode.toString(16).toUpperCase();
        if (h.length < 2) h = "0" + h;
        hex += h;
    }
    hex += "F7";
    midiOut.sendSysex(hex);
}
*/

function getPadNote(trackIndex, sceneIndex) {
    // Bottom row (scene 3) is 68..75, Top row (scene 0) is 92..99
    return 92 - (sceneIndex * 8) + trackIndex;
}

function getTrackAndSceneFromNote(note) {
    if (note >= 68 && note <= 99) {
        var offset = note - 68;
        var trackIndex = offset % 8;
        var row = Math.floor(offset / 8);
        var sceneIndex = 3 - row;
        return { track: trackIndex, scene: sceneIndex };
    }
    return null;
}

function flush() {
    // Redraw LEDs
    // Transport
    midiOut.sendMidi(0xB0, MOVE_PLAY, transport.isPlaying().get() ? COLOR_GREEN : 0);
    midiOut.sendMidi(0xB0, MOVE_REC, transport.isArrangerRecordEnabled().get() ? COLOR_RED : 0);

    // Pads - Clip Launcher
    for (var t = 0; t < 8; t++) {
        var track = trackBank.getItemAt(t);
        var clipLauncher = track.clipLauncherSlotBank();

        for (var s = 0; s < 4; s++) {
            var slot = clipLauncher.getItemAt(s);
            var color = COLOR_EMPTY;

            if (slot.isRecording().get() || slot.isRecordingQueued().get()) {
                color = COLOR_RECORDING; // Red
            } else if (slot.isPlaying().get() || slot.isPlaybackQueued().get()) {
                color = COLOR_PLAYING; // Green
            } else if (slot.hasContent().get()) {
                color = COLOR_HAS_CLIP;
            }

            var note = getPadNote(t, s);
            // Only send note on/off for pads that are actually changing state
            // This prevents sending the same state repeatedly
            midiOut.sendMidi(0x90, note, color);
        }
    }
}

function onMidi0(status, data1, data2) {
    var msgType = status & 0xF0;
    var isNoteOn = msgType === 0x90 && data2 > 0;
    var isNoteOff = msgType === 0x80 || (msgType === 0x90 && data2 === 0);
    var isCC = msgType === 0xB0;

    if (isCC) {
        if (data1 === MOVE_SHIFT) {
            shiftDown = data2 > 0;
            return;
        }

        // Encoder knobs (CC 71-78) — raw relative values
        if (data1 >= CC_KNOB_FIRST && data1 <= CC_KNOB_LAST) {
            var knobIdx = data1 - CC_KNOB_FIRST;
            var rc = remoteControls.getParameter(knobIdx);
            var delta = decodeDelta(data2);
            if (delta !== 0) {
                rc.inc(delta, ENCODER_RESOLUTION);
                sendTextCC(3, rc.name().get());
                sendTextCC(4, rc.value().displayedValue().get());
                commitText();
            }
            return;
        }

        // Master knob (CC 79) — could control track volume or BPM; skip for now
        // Navigation buttons only fire on press (data2 > 0)
        if (data2 > 0) {
            if (data1 === MOVE_PLAY) {
                transport.isPlaying().toggle();
            } else if (data1 === MOVE_REC) {
                transport.isArrangerRecordEnabled().toggle();
            } else if (data1 === MOVE_LEFT) {
                if (shiftDown) cursorDevice.selectPrevious();
                else trackBank.scrollBackwards();
            } else if (data1 === MOVE_RIGHT) {
                if (shiftDown) cursorDevice.selectNext();
                else trackBank.scrollForwards();
            } else if (data1 === MOVE_UP) {
                trackBank.sceneBank().scrollBackwards();
            } else if (data1 === MOVE_DOWN) {
                trackBank.sceneBank().scrollForwards();
            }
        }
    } else if (isNoteOn) {
        // Capacitive touch on knobs (Note 0-7)
        if (data1 >= TOUCH_KNOB_FIRST && data1 <= TOUCH_KNOB_LAST) {
            var knobIndex = data1 - TOUCH_KNOB_FIRST;
            var rc = remoteControls.getParameter(knobIndex);

            // Show device + parameter name/value on the Move OLED
            sendTextCC(1, cursorDevice.name().get());
            sendTextCC(2, "");
            sendTextCC(3, rc.name().get());
            sendTextCC(4, rc.value().displayedValue().get());
            commitText();
        } else {
            // Pad press — launch clip
            var cell = getTrackAndSceneFromNote(data1);
            if (cell) {
                var track = trackBank.getItemAt(cell.track);
                var slot = track.clipLauncherSlotBank().getItemAt(cell.scene);
                slot.launch();
            }
        }
    }
}

function onSysex0(data) { }
function exit() { }