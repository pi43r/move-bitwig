/*
 * Bitwig Move Controller Module
 *
 * Overtake module for Ableton Move that bridges hardware I/O to Bitwig Studio.
 * - Passes pad notes, relative knob CCs, and navigation through to Bitwig via external MIDI.
 * - Parses SysEx display updates from Bitwig and renders them on the Move OLED.
 * - Knobs send RAW relative delta CC 71-78 (1-63 CW, 64-127 CCW) — Bitwig uses inc().
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
    setLED, clearAllLEDs, decodeDelta
} from '/data/UserData/schwung/shared/input_filter.mjs';

/* State */
let bank = 0;
let shiftHeld = false;

/* Progressive LED init - spread LED setup over multiple frames to avoid buffer overflow */
let ledInitPending = false;
let ledInitIndex = 0;
const LEDS_PER_FRAME = 8;  /* Send 8 LED messages per frame */

/* Display state */
let line1 = "Bitwig Move";
let line2 = "";
let line3 = "";
let line4 = "";

/* SysEx accumulation buffer - ALSA/USB may fragment SysEx into multiple packets */
let sysexBuffer = [];
let sysexReceiving = false;

/* Get text over CC */
let textBuffers = ["", "", "", ""];
let pendingBuffers = ["", "", "", ""];

function drawUI() {
    clear_screen();
    print(2, 2, line1, 1);
    print(2, 18, line2, 1);
    print(2, 34, line3, 1);
    print(2, 50, line4, 1);
}

function displayMessage(l1, l2, l3, l4) {
    if (l1 !== undefined) line1 = l1;
    if (l2 !== undefined) line2 = l2;
    if (l3 !== undefined) line3 = l3;
    if (l4 !== undefined) line4 = l4;
}

function updateStatusLine() {
    line4 = `Bank ${bank + 1}`;
}

/* Process a fully assembled SysEx message */
function processSysEx(bytes) {
    if (bytes.length < 3) return;
    if (bytes[0] !== 0xF0) return;
    if (bytes[1] !== 0x7D) return; /* Our custom manufacturer ID */

    const command = bytes[2];
    let strData = "";
    for (let i = 3; i < bytes.length - 1; i++) {
        strData += String.fromCharCode(bytes[i]);
    }

    switch (command) {
        case 0x01: line1 = strData; break;
        case 0x02: line2 = strData; break;
        case 0x03: line3 = strData; break;
        case 0x04: line4 = strData; break;
    }
}

globalThis.onMidiMessageExternal = function (data) {
    if (isNoiseMessage(data)) return;

    /* Log every external message for debugging — remove once confirmed working */
    //const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    //console.log(`EXT: [${hex}] len=${data.length}`);

    /* ---------------------------------------------------------------
     * SysEx detection.
     * The schwung framework may deliver SysEx in different formats:
     *  (a) data[0] === 0xF0  → raw byte array starting with SysEx
     *  (b) data[1] === 0xF0  → USB-MIDI 4-byte packet where data[0]
     *                          is the cable/type header byte
     * We handle both by checking both positions.
     * --------------------------------------------------------------- */
    const rawSysex = data[0] === 0xF0 ? 0 : (data[1] === 0xF0 ? 1 : -1);

    /*
    if (rawSysex >= 0 || sysexReceiving) {
        const bytes = rawSysex === 1 ? Array.from(data).slice(1) : Array.from(data);

        if (!sysexReceiving) {
            sysexBuffer = bytes;
            sysexReceiving = true;
        } else {
            for (let i = 0; i < bytes.length; i++) sysexBuffer.push(bytes[i]);
        }

        if (sysexBuffer.includes(0xF7)) {
            console.log(`SysEx complete: [${sysexBuffer.map(b => b.toString(16).padStart(2,'0')).join(' ')}]`);
            processSysEx(sysexBuffer);
            sysexBuffer = [];
            sysexReceiving = false;
        }
        return;
    }
    */

    /* ---------------------------------------------------------------
     * Text-over-CC display (Bitwig → Move)
     * --------------------------------------------------------------- */
    const msgStatus = data[0] & 0xF0;

    if (msgStatus === MidiCC) {
        const cc = data[1];
        const value = data[2];
        // Text lines
        if (cc >= 110 && cc <= 113) {
            const line = cc - 110;

            if (value === 1) {
                pendingBuffers[line] = "";
                return;
            }
            if (value === 0) {
                return;
            }
            pendingBuffers[line] += String.fromCharCode(value);
            return;
        }

        // Commit
        if (cc === 114) {
            for (let i = 0; i < 4; i++) {
                if (pendingBuffers[i].length > 0) {
                    textBuffers[i] = pendingBuffers[i];
                    pendingBuffers[i] = "";
                }
            }
            console.log(`COMMIT → ${JSON.stringify(textBuffers)}`);
            // Apply to display
            line1 = textBuffers[0];
            line2 = textBuffers[1];
            line3 = textBuffers[2];
            line4 = textBuffers[3];

            return;
        }
    }

    /* ---------------------------------------------------------------
     * NoteOn / NoteOff from Bitwig = pad LED update.
     * Do NOT pass to move_midi_internal_send — that triggers the synth.
     * Instead, use setLED() which only affects the LED ring.
     * --------------------------------------------------------------- */
    if (msgStatus === MidiNoteOn || msgStatus === MidiNoteOff) {
        const note = data[1];
        const velocity = data[2];
        const color = (msgStatus === MidiNoteOn && velocity > 0) ? velocity : Black;
        setLED(note, color);
        return;
    }

    /* CC messages (transport LED state etc.) — pass through normally */
    move_midi_internal_send([data[0] >> 4, data[0], data[1], data[2]]);
};

globalThis.onMidiMessageInternal = function (data) {
    if (isNoiseMessage(data)) return;
    if (isCapacitiveTouchMessage(data)) {
        /* Pass touch messages to Bitwig so it can react */
        move_midi_external_send([2 << 4 | (data[0] / 16), data[0], data[1], data[2]]);
        return;
    }

    const status = data[0] & 0xF0;
    const d1 = data[1];
    const d2 = data[2];

    const isNote = status === MidiNoteOn || status === MidiNoteOff;
    const isNoteOn = status === MidiNoteOn;
    const isCC = status === MidiCC;

    if (isNote) {
        let note = d1;
        let velocity = d2;

        /* Bank switching via step buttons — just update LED and display */
        if (MoveSteps.includes(note) && velocity === 127) {
            setLED(MoveSteps[bank], Black);
            bank = MoveSteps.indexOf(note);
            setLED(note, White);
            displayMessage("Bitwig Move", `Bank ${bank + 1}`, "", "");
            updateStatusLine();
            return;
        }

        /* Forward pad notes to Bitwig as-is */
        if (MovePads.includes(note)) {
            move_midi_external_send([2 << 4 | (status / 16), status, note, velocity]);
            return;
        }
    }

    if (isCC) {
        let ccNumber = d1;
        let value = d2;

        /* Shift state tracking */
        if (ccNumber === MoveShift) {
            shiftHeld = value === 127;
            if (shiftHeld) {
                displayMessage(undefined, "Shift held", "", undefined);
            } else {
                displayMessage(undefined, "", "", undefined);
                updateStatusLine();
            }
            return;
        }

        /* Pass Jog wheel to external */
        if (ccNumber === MoveMainKnob) {
            move_midi_external_send([2 << 4 | 0x0b, MidiCC, ccNumber, value]);
            return;
        }

        /* Up/Down buttons to external */
        if (ccNumber === MoveUp) {
            move_midi_external_send([2 << 4 | 0x0b, MidiCC, ccNumber, value]);
            return;
        }
        if (ccNumber === MoveDown) {
            move_midi_external_send([2 << 4 | 0x0b, MidiCC, ccNumber, value]);
            return;
        }

        /* Knob CCs (71-78) - pass raw relative delta directly to Bitwig.
         * Bitwig uses inc(delta, resolution) on the parameter, so we do NOT
         * convert to absolute here. The raw value encodes direction:
         * 1-63 = clockwise, 64-127 = counter-clockwise. */
        if (ccNumber >= MoveKnob1 && ccNumber <= MoveKnob8) {
            /* Forward raw relative CC unchanged on same CC number */
            move_midi_external_send([2 << 4 | 0x0b, MidiCC, ccNumber, value]);
            return;
        }

        /* Master knob (CC 79) - pass raw relative delta to Bitwig */
        if (ccNumber === MoveMaster) {
            move_midi_external_send([2 << 4 | 0x0b, MidiCC, ccNumber, value]);
            return;
        }

        /* Forward other CCs as-is */
        move_midi_external_send([2 << 4 | 0x0b, MidiCC, ccNumber, value]);
    }
};

/* Progressive LED setup - light all pads dim on init; Bitwig will overwrite with clip colors */
function setupLedBatch() {
    const ledsToSet = [
        { note: MoveSteps[bank], color: White }  /* Bank indicator */
    ];
    for (const pad of MovePads) {
        ledsToSet.push({ note: pad, color: LightGrey });
    }

    const start = ledInitIndex;
    const end = Math.min(start + LEDS_PER_FRAME, ledsToSet.length);

    for (let i = start; i < end; i++) {
        setLED(ledsToSet[i].note, ledsToSet[i].color);
    }

    ledInitIndex = end;
    if (ledInitIndex >= ledsToSet.length) {
        ledInitPending = false;
        ledInitIndex = 0;
    }
}

globalThis.init = function () {
    console.log("Bitwig Move module starting..");

    displayMessage("Bitwig Move", "Connecting...", "", "");
    updateStatusLine();

    sysexBuffer = [];
    sysexReceiving = false;

    /* Note: LEDs are cleared by host before loading overtake module.
     * Use progressive LED init to avoid buffer overflow. */
    ledInitPending = true;
    ledInitIndex = 0;
};

globalThis.tick = function () {
    /* Continue progressive LED setup if pending */
    if (ledInitPending) {
        setupLedBatch();
    }

    drawUI();
};