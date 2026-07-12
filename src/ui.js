/*
 * Bitwig Move Controller Module — protocol v2 (sysex)
 *
 * All Bitwig -> Move feedback (display text, LED state) arrives as sysex,
 * so it can never collide with hardware input (which is plain notes/CCs).
 * This removes the old Middleman CC bridge, the text-over-CC protocol and
 * every echo-filter heuristic.
 *
 * Sysex framing (both directions):
 *   F0 7D 4D 42 <cmd> <payload...> F7        (7D = educational/dev ID, "MB" magic)
 *
 * Bitwig -> module commands:
 *   0x00 PING  <seq>                          heartbeat, reply with PONG
 *   0x01 TEXT  <line 0-3> <ascii chars...>    replace one display line
 *   0x02 LED_NOTE <(note, color)...>          palette LEDs via note-on (pads/steps)
 *   0x03 LED_CC   <(cc, color)...>            palette/brightness LEDs via CC (buttons)
 *   0x04 LED_RGB  <(idx, r7, g7, b7)...>      direct RGB (7-bit per channel);
 *                                             re-emitted as Ableton LED sysex on cable 0.
 *                                             idx = CC number; only CC-addressed RGB
 *                                             LEDs (40-43, 71-78, 118, transport).
 *                                             Pads use LED_NOTE (palette) like Move
 *                                             firmware does — the sysex idx space is
 *                                             flat and CCs own their numbers.
 *   0x05 CLEAR                                all LEDs off (progressive)
 *   0x06 BARS  <8 x value 0-127>              show 8 parameter bars on the lower
 *                                             display half; empty payload hides
 *   0x7E HELLO <protoVersion>                 handshake; module replies HELLO_ACK
 *
 * Module -> Bitwig commands:
 *   0x40 PONG <seq>
 *   0x41 HELLO_ACK <protoVersion>
 */

import {
    MidiNoteOn, MidiNoteOff, MidiCC,
    MoveShift, MoveMenu, MoveBack, MoveCapture,
    MoveDown, MoveUp, MoveUndo, MoveLoop, MoveCopy,
    MoveLeft, MoveRight, MoveMainKnob,
    MoveKnob1, MoveKnob8, MoveMaster,
    MovePlay, MoveRec, MoveMute, MoveRecord, MoveDelete,
    MovePads, MoveSteps
} from '/data/UserData/schwung/shared/constants.mjs';

import {
    isNoiseMessage, setLED, setButtonLED
} from '/data/UserData/schwung/shared/input_filter.mjs';

const PROTO_VERSION = 2;

/* Sysex header after 0xF0: dev ID + "MB" magic */
const SYX_HEADER = [0x7D, 0x4D, 0x42];

const CMD_PING = 0x00;
const CMD_TEXT = 0x01;
const CMD_LED_NOTE = 0x02;
const CMD_LED_CC = 0x03;
const CMD_LED_RGB = 0x04;
const CMD_CLEAR = 0x05;
const CMD_BARS = 0x06;
const CMD_HELLO = 0x7E;
const CMD_PONG = 0x40;
const CMD_HELLO_ACK = 0x41;

/* Hardware input forwarded to Bitwig (everything else is dropped). */
const FORWARD_CC = new Set([
    MoveShift, MoveMenu, MoveBack, MoveCapture,
    MoveDown, MoveUp, MoveUndo, MoveLoop, MoveCopy,
    MoveLeft, MoveRight,
    MoveMainKnob, 3, /* jog turn / jog click */
    MoveKnob1, MoveKnob1 + 1, MoveKnob1 + 2, MoveKnob1 + 3,
    MoveKnob1 + 4, MoveKnob1 + 5, MoveKnob1 + 6, MoveKnob8,
    MoveMaster,
    MovePlay, MoveRec, MoveMute, MoveRecord, MoveDelete,
    40, 41, 42, 43 /* track buttons */
]);

const FORWARD_NOTES = new Set([
    ...MovePads,
    ...MoveSteps,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9 /* capacitive knob touches */
]);

/* CC LEDs that physically exist (for progressive clear) */
const HW_CC_LEDS = [
    16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    40, 41, 42, 43,
    49, 50, 51, 52, 54, 55, 56, 58, 60, 62, 63,
    71, 72, 73, 74, 75, 76, 77, 78,
    85, 86, 88, 118, 119
];

/* Max USB-MIDI packets we push into the hardware mailbox per tick.
 * The mailbox holds 20 packets/frame and is shared with the shim's own
 * LED queue, so stay well below. */
const MAX_TX_PACKETS_PER_TICK = 12;

/* Connection timeout: Bitwig pings every ~1s */
const LINK_TIMEOUT_MS = 4000;

const state = {
    lines: ["", "", "", ""],
    bars: null,           // array of 8 values 0-127, or null (text lines 3+4 shown)
    connected: false,
    lastRxMs: 0,
    /* outgoing packet queue: flat array of [head, b1, b2, b3] packets */
    txQueue: [],
    /* progressive LED clear */
    clearList: [],
    clearIdx: 0,
    /* sysex reassembly (from Bitwig) */
    syxBuf: [],
    syxActive: false
};

/* ============ Outgoing queue ============ */

function queuePackets(packets) {
    /* Bound the queue so a stalled mailbox can't grow memory forever. */
    if (state.txQueue.length > 2048) return;
    for (const p of packets) state.txQueue.push(p);
}

function drainTxQueue() {
    let budget = MAX_TX_PACKETS_PER_TICK;
    while (budget > 0 && state.txQueue.length > 0) {
        const p = state.txQueue.shift();
        /* head nibble decides destination; cable is re-stamped by the host
         * binding, so route on our own marker: packets destined for Bitwig
         * carry cable 2 in the head, hardware sysex carries cable 0. */
        if (((p[0] >> 4) & 0x0F) === 2) {
            move_midi_external_send(p);
        } else {
            move_midi_internal_send(p);
        }
        budget--;
    }
}

/* Encode a full sysex byte array (F0 ... F7) into USB-MIDI packets. */
function sysexToPackets(bytes, cable) {
    const packets = [];
    let i = 0;
    while (i < bytes.length) {
        const remaining = bytes.length - i;
        if (remaining > 3) {
            packets.push([(cable << 4) | 0x04, bytes[i], bytes[i + 1], bytes[i + 2]]);
            i += 3;
        } else {
            /* CIN 0x05/0x06/0x07 = sysex end with 1/2/3 bytes */
            const cin = 0x04 + remaining;
            packets.push([
                (cable << 4) | cin,
                bytes[i],
                remaining >= 2 ? bytes[i + 1] : 0,
                remaining >= 3 ? bytes[i + 2] : 0
            ]);
            i += remaining;
        }
    }
    return packets;
}

function sendToBitwig(cmd, payload) {
    const bytes = [0xF0, ...SYX_HEADER, cmd, ...(payload || []), 0xF7];
    queuePackets(sysexToPackets(bytes, 2));
}

/* Ableton RGB LED sysex on cable 0:
 * F0 00 21 1D 01 01 3B 10 <idx> <r_lo> <r_hi> <g_lo> <g_hi> <b_lo> <b_hi> F7
 * idx = CC number for buttons/knobs, note number for pads. */
function queueRgbLed(idx, r8, g8, b8) {
    const bytes = [
        0xF0, 0x00, 0x21, 0x1D, 0x01, 0x01, 0x3B, 0x10, idx & 0x7F,
        r8 & 0x7F, (r8 >> 7) & 0x7F,
        g8 & 0x7F, (g8 >> 7) & 0x7F,
        b8 & 0x7F, (b8 >> 7) & 0x7F,
        0xF7
    ];
    queuePackets(sysexToPackets(bytes, 0));
}

/* ============ Incoming sysex (from Bitwig) ============ */

function handleSysexMessage(msg) {
    /* msg = full bytes between F0 and F7 (exclusive) */
    if (msg.length < SYX_HEADER.length + 1) return;
    for (let i = 0; i < SYX_HEADER.length; i++) {
        if (msg[i] !== SYX_HEADER[i]) return;
    }
    const cmd = msg[SYX_HEADER.length];
    const payload = msg.slice(SYX_HEADER.length + 1);

    state.lastRxMs = Date.now();
    state.connected = true;

    switch (cmd) {
        case CMD_PING:
            sendToBitwig(CMD_PONG, [payload[0] || 0]);
            break;

        case CMD_HELLO:
            sendToBitwig(CMD_HELLO_ACK, [PROTO_VERSION]);
            startLedClear();
            break;

        case CMD_TEXT: {
            if (payload.length < 1) return;
            const line = payload[0];
            if (line > 3) return;
            let text = "";
            for (let i = 1; i < payload.length; i++) {
                const c = payload[i];
                if (c >= 32 && c <= 126) text += String.fromCharCode(c);
            }
            state.lines[line] = text;
            break;
        }

        case CMD_LED_NOTE:
            for (let i = 0; i + 1 < payload.length; i += 2) {
                setLED(payload[i], payload[i + 1]);
            }
            break;

        case CMD_LED_CC:
            for (let i = 0; i + 1 < payload.length; i += 2) {
                setButtonLED(payload[i], payload[i + 1]);
            }
            break;

        case CMD_LED_RGB:
            for (let i = 0; i + 3 < payload.length; i += 4) {
                /* 7-bit per channel from Bitwig; scale to 8-bit (127 -> 254~255) */
                const scale = (v) => v >= 127 ? 255 : v << 1;
                queueRgbLed(payload[i], scale(payload[i + 1]),
                            scale(payload[i + 2]), scale(payload[i + 3]));
            }
            break;

        case CMD_CLEAR:
            startLedClear();
            break;

        case CMD_BARS:
            state.bars = (payload.length >= 8) ? payload.slice(0, 8) : null;
            break;
    }
}

/* Reassemble sysex from the 3-byte chunks the host delivers.
 * Chunks lose the USB-MIDI CIN, so: start at 0xF0, end at 0xF7, bytes
 * after 0xF7 within a chunk are padding. Returns true if the chunk was
 * consumed as (part of) a sysex message. */
function feedSysexChunk(data) {
    let consumed = state.syxActive;
    for (let i = 0; i < data.length; i++) {
        const b = data[i];
        if (b === 0xF0) {
            state.syxBuf = [];
            state.syxActive = true;
            consumed = true;
            continue;
        }
        if (!state.syxActive) break;
        if (b === 0xF7) {
            handleSysexMessage(state.syxBuf);
            state.syxBuf = [];
            state.syxActive = false;
            break; /* rest of chunk is padding */
        }
        if (b >= 0x80) {
            /* Interleaved voice status mid-sysex: abort reassembly. */
            state.syxBuf = [];
            state.syxActive = false;
            return false;
        }
        if (state.syxBuf.length < 512) state.syxBuf.push(b);
    }
    return consumed;
}

/* ============ MIDI handlers ============ */

globalThis.onMidiMessageExternal = function (data) {
    try {
        /* Sysex reassembly first — chunks carry data bytes < 0x80 that the
         * noise filter would misclassify. */
        if (feedSysexChunk(data)) return;
        /* Non-sysex traffic from Bitwig is not part of protocol v2: ignore. */
    } catch (e) {
        console.log(`move-bitwig ext error: ${e}`);
    }
};

globalThis.onMidiMessageInternal = function (data) {
    try {
        if (isNoiseMessage(data)) return;

        const status = data[0] & 0xF0;
        const d1 = data[1];
        const d2 = data[2];

        if (status === MidiCC) {
            if (!FORWARD_CC.has(d1)) return;
            move_midi_external_send([(2 << 4) | 0x0B, data[0], d1, d2]);
            return;
        }

        if (status === MidiNoteOn || status === MidiNoteOff) {
            if (!FORWARD_NOTES.has(d1)) return;
            const cin = (status === MidiNoteOn) ? 0x09 : 0x08;
            move_midi_external_send([(2 << 4) | cin, data[0], d1, d2]);
            return;
        }
    } catch (e) {
        console.log(`move-bitwig int error: ${e}`);
    }
};

/* ============ LED clearing (progressive) ============ */

function startLedClear() {
    const list = [];
    for (const n of MovePads) list.push(["note", n]);
    for (const n of MoveSteps) list.push(["note", n]);
    for (const cc of HW_CC_LEDS) list.push(["cc", cc]);
    state.clearList = list;
    state.clearIdx = 0;
}

function stepLedClear() {
    let budget = 8;
    while (budget > 0 && state.clearIdx < state.clearList.length) {
        const [kind, idx] = state.clearList[state.clearIdx++];
        if (kind === "note") setLED(idx, 0, true);
        else setButtonLED(idx, 0, true);
        budget--;
    }
}

/* ============ Display ============ */

function drawUI() {
    clear_screen();
    if (!state.connected) {
        print(2, 2, "Bitwig Move", 1);
        print(2, 26, "Waiting for Bitwig...", 1);
        print(2, 50, "v" + PROTO_VERSION + " sysex", 1);
        return;
    }
    print(2, 2, state.lines[0], 1);
    print(2, 18, state.lines[1], 1);

    if (state.bars) {
        /* 8 parameter bars in the lower display half (y 34..62) */
        for (let i = 0; i < 8; i++) {
            const v = state.bars[i];
            const x = 4 + i * 15;
            const h = Math.max(1, Math.round((v / 127) * 26));
            fill_rect(x, 62 - h, 11, h, 1);
            /* baseline tick so empty params are still visible */
            fill_rect(x, 62, 11, 1, 1);
        }
        return;
    }

    print(2, 34, state.lines[2], 1);
    print(2, 50, state.lines[3], 1);
}

/* ============ Lifecycle ============ */

globalThis.init = function () {
    state.lines = ["", "", "", ""];
    state.bars = null;
    state.connected = false;
    state.lastRxMs = 0;
    state.txQueue = [];
    state.syxBuf = [];
    state.syxActive = false;
    startLedClear();
};

globalThis.tick = function () {
    stepLedClear();
    drainTxQueue();

    if (state.connected && Date.now() - state.lastRxMs > LINK_TIMEOUT_MS) {
        state.connected = false;
        state.bars = null;
        startLedClear();
    }

    /* Redraw every tick — the display is flushed at the host refresh rate
     * (~11 Hz) and this is the proven pattern for overtake modules. */
    drawUI();
};

globalThis.onUnload = function () {
    /* Best effort: LEDs are cleared/restored by the host on overtake exit. */
    state.txQueue = [];
};
