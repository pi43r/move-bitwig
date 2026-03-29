/*
 * Bitwig Move Controller Module
 *
 * Refactored Overtake module with Middleman CC Bridge for feedback loop termination.
 */

import {
    Black, White, LightGrey, Red, Blue,
    MidiNoteOn, MidiNoteOff, MidiCC,
    MoveShift, MoveMainKnob, MoveUp, MoveDown,
    MovePads, MoveSteps,
    MoveKnob1, MoveKnob8, MoveMaster
} from '/data/UserData/schwung/shared/constants.mjs';

import {
    isNoiseMessage, isCapacitiveTouchMessage,
    setLED, setButtonLED, clearAllLEDs
} from '/data/UserData/schwung/shared/input_filter.mjs';

/* State Management */
const state = {
    lines: ["Bitwig Move", "Bitwig Studio", "", ""],
    pendingLines: ["", "", "", ""],
    bank: 0,
    shiftHeld: false,
    lastSentLED: {}
};

/* MIDI Routing Configuration */
const CONTROLS = {
    CC: [
        MoveShift, MoveMainKnob, MoveUp, MoveDown,
        MoveMaster, MoveKnob1, MoveKnob1 + 1, MoveKnob1 + 2, MoveKnob1 + 3,
        MoveKnob1 + 4, MoveKnob1 + 5, MoveKnob1 + 6, MoveKnob8,
        85, 86 // Play, Rec buttons
    ],
    NOTES: [
        ...MovePads,
        ...MoveSteps,
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9 // Knob touches
    ],
    // Virtual CC Mapping for Middleman Bridge
    BRIDGE: {
        100: 85, // Virtual Play -> Physical 85
        101: 86  // Virtual Rec -> Physical 86
    }
};

function drawUI() {
    clear_screen();
    print(2, 2, state.lines[0], 1);
    print(2, 18, state.lines[1], 1);
    print(2, 34, state.lines[2], 1);
    print(2, 50, state.lines[3], 1);
}

/**
 * Decode MIDI data to handle 3-byte and 4-byte messages.
 */
function decodeMidi(data) {
    if (data[0] >= 0x80) return data;
    if (data.length === 4) return data.slice(1);
    return data;
}

/**
 * Handle MIDI from Bitwig (External)
 */
globalThis.onMidiMessageExternal = function (data) {
    try {
        if (isNoiseMessage(data)) return;

        const raw = decodeMidi(data);
        const status = raw[0] & 0xF0;
        const b1 = raw[1];
        const b2 = raw[2];

        if (status === MidiCC) {
            // 1. Middleman Bridge Translation
            if (CONTROLS.BRIDGE[b1]) {
                setButtonLED(CONTROLS.BRIDGE[b1], b2);
                return;
            }

            // 2. Text-over-CC Protocol
            if (b1 >= 110 && b1 <= 113) {
                const lineIdx = b1 - 110;
                if (b2 === 1) state.pendingLines[lineIdx] = "";
                else if (b2 > 0) state.pendingLines[lineIdx] += String.fromCharCode(b2);
                return;
            }

            if (b1 === 114 && b2 === 1) {
                for (let i = 0; i < 4; i++) {
                    if (state.pendingLines[i] !== undefined) state.lines[i] = state.pendingLines[i];
                }
                return;
            }

            // 3. Standard LED Feedback
            state.lastSentLED[`CC_${b1}`] = b2;
            setButtonLED(b1, b2);
            return;
        }

        if (status === MidiNoteOn || status === MidiNoteOff) {
            const color = (status === MidiNoteOn && b2 > 0) ? b2 : Black;
            state.lastSentLED[`Note_${b1}`] = color;
            setLED(b1, color);
            return;
        }
    } catch (e) {
        // console.log(`Error: ${e}`);
    }
};

/**
 * Handle MIDI from Hardware (Internal)
 */
globalThis.onMidiMessageInternal = function (data) {
    try {
        if (isNoiseMessage(data)) return;

        const raw = decodeMidi(data);
        const type = raw[0] & 0xF0;
        const d1 = raw[1];
        const d2 = raw[2];

        if (isCapacitiveTouchMessage(raw)) {
            move_midi_external_send([2 << 4 | (raw[0] >> 4), raw[0], raw[1], raw[2]]);
            return;
        }

        if (type === MidiCC) {
            if (d1 >= 110 && d1 <= 114) return;

            if (CONTROLS.CC.includes(d1)) {
                // Echo filter
                if (state.lastSentLED[`CC_${d1}`] === d2) return;

                // Strict push-only for transport buttons
                if ((d1 === 85 || d1 === 86) && d2 !== 127) return;

                if (d1 === MoveShift) state.shiftHeld = (d2 === 127);
                move_midi_external_send([2 << 4 | 0x0b, type, d1, d2]);
            }
        } else if (type === MidiNoteOn || type === MidiNoteOff) {
            if (CONTROLS.NOTES.includes(d1)) {
                // Echo filter
                const noteColor = (type === MidiNoteOn) ? d2 : Black;
                if (state.lastSentLED[`Note_${d1}`] === noteColor) return;

                move_midi_external_send([2 << 4 | (type / 16), type, d1, d2]);
            }
        }
    } catch (e) {
        // console.log(`Error: ${e}`);
    }
};

globalThis.init = function () {
    state.lines = ["Bitwig Move", "", "", ""];
    state.pendingLines = ["", "", "", ""];
    state.lastSentLED = {};
    clearAllLEDs();
};

globalThis.tick = function () {
    drawUI();
};