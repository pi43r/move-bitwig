/*
 * Bitwig Move Controller Module — protocol v2 (sysex)
 *
 * All Bitwig -> Move feedback (display text, LED state) arrives as sysex,
 * so it can never collide with hardware input (which is plain notes/CCs).
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
 *   0x07 BARS  <bars, loopStart, loopEnd,      clip bar overview under the text
 *              playingBar+1, pageStart, pageEnd, (optional; empty payload hides)
 *              progress 1-16>
 *
 * Line 1 of TEXT is a "KIND|track" header record: the header shows KIND's
 * icon and the track name (see drawDisplay below).
 *   0x7E HELLO <protoVersion>                 handshake; module replies HELLO_ACK
 *
 * Module -> Bitwig commands:
 *   0x40 PONG <seq>
 *   0x41 HELLO_ACK <protoVersion, capabilities>
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
const CMD_SEQUENCE = 0x07;
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
    connected: false,
    sequence: null,
    dirty: true,
    nextDrawMs: 0,
    pendingLeds: new Map(),
    lastRxMs: 0,
    /* outgoing packet queue: flat array of [head, b1, b2, b3] packets */
    txQueue: [],
    /* progressive LED clear */
    clearList: [],
    clearIdx: 0,
    /* sysex reassembly (from Bitwig) */
    syxBuf: [],
    syxActive: false,
    /* master volume knob touched (note 8) */
    volumeTouched: false
};

/* ============ Outgoing queue ============ */

function queuePackets(packets) {
    /* Bound the queue so a stalled mailbox can't grow memory forever. */
    if (state.txQueue.length > 2048) return;
    for (const p of packets) state.txQueue.push(p);
}

function drainTxQueue(budget) {
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
    return budget;
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

    const lengths = { 0: 1, 5: 0, 126: 1 };
    if (lengths[cmd] !== undefined && payload.length !== lengths[cmd]) return;
    if (cmd === CMD_TEXT && (payload.length < 1 || payload.length > 49 || payload[0] > 3)) return;
    if ((cmd === CMD_LED_NOTE || cmd === CMD_LED_CC) && payload.length % 2 !== 0) return;
    if (cmd === CMD_LED_RGB && payload.length % 4 !== 0) return;
    if (cmd === CMD_SEQUENCE && payload.length !== 0 && (payload.length !== 7 || payload[0] < 1
        || payload[0] > 64 || payload.slice(1, 6).some(v => v > payload[0]) || payload[6] > 16)) return;
    if (![CMD_PING, CMD_TEXT, CMD_LED_NOTE, CMD_LED_CC, CMD_LED_RGB,
        CMD_CLEAR, CMD_SEQUENCE, CMD_HELLO].includes(cmd)) return;
    if (cmd === CMD_HELLO && payload[0] !== PROTO_VERSION) {
        sendToBitwig(CMD_HELLO_ACK, [PROTO_VERSION, 3]);
        return;
    }
    state.dirty = true;
    state.lastRxMs = Date.now();
    state.connected = true;

    switch (cmd) {
        case CMD_PING:
            sendToBitwig(CMD_PONG, [payload[0] || 0]);
            break;

        case CMD_HELLO:
            sendToBitwig(CMD_HELLO_ACK, [PROTO_VERSION, 3]);
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
                state.pendingLeds.set("note:" + payload[i], ["note", payload[i], payload[i + 1]]);
            }
            break;

        case CMD_LED_CC:
            for (let i = 0; i + 1 < payload.length; i += 2) {
                state.pendingLeds.set("cc:" + payload[i], ["cc", payload[i], payload[i + 1]]);
            }
            break;

        case CMD_LED_RGB:
            for (let i = 0; i + 3 < payload.length; i += 4) {
                /* 7-bit per channel from Bitwig; scale to 8-bit (127 -> 254~255) */
                const scale = (v) => v >= 127 ? 255 : v << 1;
                state.pendingLeds.set("cc:" + payload[i], ["rgb", payload[i], scale(payload[i + 1]),
                    scale(payload[i + 2]), scale(payload[i + 3])]);
            }
            break;

        case CMD_CLEAR:
            startLedClear();
            break;

        case CMD_SEQUENCE:
            state.sequence = payload.length ? payload : null;
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
        if (b >= 0xF8) continue; // MIDI real-time can be interleaved in SysEx.
        if (b >= 0x80) {
            /* Interleaved voice status mid-sysex: abort reassembly. */
            state.syxBuf = [];
            state.syxActive = false;
            return false;
        }
        if (state.syxBuf.length >= 512) {
            state.syxBuf = [];
            state.syxActive = false;
            return true; // discard the entire oversized frame, never a valid-looking prefix
        }
        state.syxBuf.push(b);
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
            if (d1 === 8) state.volumeTouched = status === MidiNoteOn && d2 > 0;
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
    state.pendingLeds.clear();
    const list = [];
    for (const n of MovePads) list.push(["note", n]);
    for (const n of MoveSteps) list.push(["note", n]);
    for (const cc of HW_CC_LEDS) list.push(["cc", cc]);
    state.clearList = list;
    state.clearIdx = 0;
}

function stepLedClear(budget) {
    while (budget > 0 && state.clearIdx < state.clearList.length) {
        const [kind, idx] = state.clearList[state.clearIdx++];
        if (kind === "note") setLED(idx, 0, true);
        else setButtonLED(idx, 0, true);
        budget--;
    }
    return budget;
}

/* ============ LED feedback ============ */

// Apply feedback only after the progressive clear has finished. Coalesce by
// physical destination so stale clear work cannot overwrite a fresh repaint.
function applyPendingLeds(budget) {
    if (state.clearIdx < state.clearList.length) return;
    for (const [key, led] of state.pendingLeds) {
        const cost = led[0] === "rgb" ? 6 : 1;
        if (budget < cost) break;
        if (led[0] === "note") setLED(led[1], led[2]);
        else if (led[0] === "cc") setButtonLED(led[1], led[2], true);
        else {
            queueRgbLed(led[1], led[2], led[3], led[4]);
            drainTxQueue(cost); // one complete RGB frame; never leave obsolete RGB queued
        }
        budget -= cost;
        state.pendingLeds.delete(key);
    }
}

/* ============ Screen ============ */
/*
 * Kept in this file on purpose: Schwung loads ui.js under a fresh module name
 * on every launch, but a relative import (./display.mjs) is cached by QuickJS
 * for the life of shadow_ui, so an updated import would not load until Move
 * restarts.
 *
 * Line 1 is "KIND|track": the filled header shows only KIND's icon and the
 * track name.
 *   MODE   full-screen announcement: big icon, name (line 2), subtitle (line 3)
 *   other  line 2 (scrolls when long), line 3, then line 4 (usage hint) at the
 *          bottom, or the step strip when the sequence is shown
 */
const ICONS = {
    NOTE: [12, 10, 9, 9, 25, 57, 48],
    DRUM: [62, 65, 62, 65, 65, 65, 62],
    STEP: [0, 85, 85, 0, 85, 85, 0],
    SESSION: [119, 85, 119, 0, 119, 85, 119],
    MIX: [48, 127, 48, 0, 6, 127, 6],      // two sliders
    PARAM: [8, 42, 28, 127, 28, 42, 8],
    LOOP: [62, 65, 64, 64, 65, 34, 28],
    MUTE: [4, 12, 28, 28, 28, 12, 4],
    COPY: [62, 34, 47, 41, 57, 9, 15],
    DELETE: [28, 127, 34, 42, 42, 34, 62],
    BROWSE: [48, 72, 127, 65, 65, 65, 127],
    TEMPO: [8, 20, 20, 42, 34, 65, 127],
    WORKFLOW: [0, 127, 20, 127, 34, 127, 0],
    SCALE: [1, 3, 7, 15, 31, 63, 127]
};
const screen = { key: null, changedAt: 0 };

function measure(text) {
    return typeof text_width === 'function' ? text_width(text) : text.length * 6;
}
function fit(text, width) {
    text = String(text || '');
    while (text.length && measure(text) > width) text = text.slice(0, -1);
    return text;
}
function drawIcon(kind, x, y, color, scale = 1) {
    const rows = ICONS[kind] || ICONS.SESSION;
    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
            if (rows[r] & (1 << (6 - c))) fill_rect(x + c * scale, y + r * scale, scale, scale, color);
        }
    }
}
function marquee(text, width, elapsed) {
    if (measure(text) <= width) return text;
    const travel = Math.max(1, text.length - fit(text, width).length);
    const cycle = 1200 + travel * 180 + 1200;
    const offset = Math.min(travel, Math.max(0, Math.floor((elapsed % cycle - 1200) / 180)));
    return fit(text.slice(offset), width);
}
function printCentered(text, y) {
    text = fit(text, 124);
    print(Math.max(2, Math.floor((128 - measure(text)) / 2)), y, text, 1);
}

function drawWaiting(now) {
    fill_rect(0, 0, 128, 11, 1);
    drawIcon('SESSION', 2, 2, 0);
    print(13, 2, 'MOVE BITWIG', 0);
    print(2, 20, 'Waiting for Bitwig', 1);
    const phase = Math.floor(now / 250) % 4;
    for (let i = 0; i < 4; i++) {
        if (i === phase) fill_rect(44 + i * 10, 34, 5, 5, 1);
        else draw_rect(44 + i * 10, 34, 5, 5, 1);
    }
    print(2, 48, 'Check Standalone', 1);
    print(2, 57, 'MIDI input + output', 1);
    return 250;
}

/** Mode change: icon and name settle 2px upward over ~80 ms, then hold. */
function drawMode(kind, elapsed) {
    const lift = elapsed < 40 ? 2 : elapsed < 80 ? 1 : 0;
    drawIcon(kind, 57, 12 + lift, 1, 2);
    printCentered(state.lines[1], 32 + lift);
    printCentered(state.lines[2], 46);
    return lift ? 40 : 0;
}

/*
 * Clip bar overview [bars, loopStart, loopEnd, playingBar + 1, pageStart, pageEnd,
 * progress] (bar indices, ends exclusive): one cell per bar, outlined inside the
 * loop and a baseline outside it; the playing bar fills left to right in
 * sixteenths; a line underneath marks the bars on the step buttons.
 */
function drawBars(data) {
    const [bars, loopStart, loopEnd, playing, pageStart, pageEnd, progress] = data;
    const gap = bars <= 32 ? 1 : 0;
    const left = i => 2 + Math.round(i * 124 / bars);
    for (let i = 0; i < bars; i++) {
        const x = left(i), w = Math.max(1, left(i + 1) - x - gap);
        if (i === playing - 1) {
            if (w >= 3) draw_rect(x, 48, w, 9, 1);
            fill_rect(x, 48, Math.max(1, Math.round(w * progress / 16)), 9, 1);
        } else if (i >= loopStart && i < loopEnd) {
            if (w >= 3) draw_rect(x, 48, w, 9, 1);
            else fill_rect(x, 52, w, 1, 1);
        } else fill_rect(x, 56, w, 1, 1);
        if (i >= pageStart && i < pageEnd) fill_rect(x, 60, w, 2, 1);
    }
}

/** Returns milliseconds until the next animation frame, or zero when static. */
function drawDisplay() {
    const now = Date.now();
    const key = state.connected ? state.lines[0] + ':' + state.lines[1] : 'waiting';
    if (key !== screen.key) { screen.key = key; screen.changedAt = now; }
    const elapsed = now - screen.changedAt;
    clear_screen();
    if (!state.connected) return drawWaiting(now);

    const header = state.lines[0] || '';
    const split = header.indexOf('|');
    const kind = split < 0 ? '' : header.slice(0, split);
    const title = split < 0 ? header : header.slice(split + 1);
    if (kind === 'MODE') return drawMode(title, elapsed);

    fill_rect(0, 0, 128, 11, 1);
    drawIcon(kind, 2, 2, 0);
    print(13, 2, fit(title || 'Move Bitwig', 113), 0);
    const primary = state.lines[1] || '';
    print(2, 16, marquee(primary, 124, elapsed), 1);
    print(2, 30, fit(state.lines[2], 124), 1);
    if (state.sequence) drawBars(state.sequence);
    else print(2, 54, fit(state.lines[3], 124), 1);
    return measure(primary) > 124 ? 180 : 0;
}

/* ============ Lifecycle ============ */

/* The volume knob belongs to Bitwig (master gain or last touched parameter),
 * so Move firmware must not see CC 79 / touch note 8. The shim clears this
 * flag on every overtake-mode change -- including the 0 -> 2 entry that can
 * land after init() -- so re-assert it each tick. Never raise it while the
 * knob is touched: Move would see the touch-on but not the touch-off. */
function claimVolumeKnob() {
    if (!state.volumeTouched && typeof shadow_set_overtake_suppress_master_volume === 'function')
        shadow_set_overtake_suppress_master_volume(1);
}

globalThis.init = function () {
    claimVolumeKnob();
    state.lines = ["", "", "", ""];
    state.sequence = null;
    state.dirty = true;
    state.pendingLeds.clear();
    state.nextDrawMs = 0;
    state.connected = false;
    state.lastRxMs = 0;
    state.txQueue = [];
    state.syxBuf = [];
    state.syxActive = false;
    startLedClear();
    // Announce a module restart even while the controller's heartbeat is healthy.
    sendToBitwig(CMD_HELLO_ACK, [PROTO_VERSION, 3]);
};

globalThis.tick = function () {
    claimVolumeKnob();
    if (state.connected && Date.now() - state.lastRxMs > LINK_TIMEOUT_MS) {
        state.connected = false;
        state.sequence = null;
        state.dirty = true;
        state.txQueue = [];
        state.pendingLeds.clear();
        state.syxBuf = [];
        state.syxActive = false;
        startLedClear();
    }

    let budget = drainTxQueue(MAX_TX_PACKETS_PER_TICK);
    budget = stepLedClear(budget);
    applyPendingLeds(budget);

    if (state.dirty || (state.nextDrawMs && Date.now() >= state.nextDrawMs)) {
        const delay = drawDisplay();
        state.nextDrawMs = delay ? Date.now() + delay : 0;
        state.dirty = false;
    }
};

globalThis.onUnload = function () {
    /* Best effort: LEDs are cleared/restored by the host on overtake exit. */
    state.txQueue = [];
};
