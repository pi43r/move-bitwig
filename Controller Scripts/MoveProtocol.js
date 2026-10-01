/**
 * MoveProtocol.js
 * Sysex protocol v2 between Bitwig and the move-bitwig schwung module.
 *
 * Framing: F0 7D 4D 42 <cmd> <payload...> F7
 * Commands out: PING(00, seq), TEXT(01, line, chars), LED_NOTE(02, pairs),
 *               LED_CC(03, pairs), LED_RGB(04, quads), CLEAR(05), HELLO(7E, ver)
 * Commands in:  PONG(40, seq), HELLO_ACK(41, ver)
 *
 * All LED/text setters are cached; only diffs go on the wire in flush().
 * LED batches are chunked so a single sysex stays small (device-side pacing).
 */

var MoveProtocol = (function () {
    var HEADER = "7d4d42"; // 7D (dev ID) + "MB" magic — F0 is prepended when sending
    var PROTO_VERSION = 2;
    var PING_INTERVAL_MS = 1000;
    var LINK_TIMEOUT_MS = 3500;
    var MAX_PAIRS_PER_MSG = 16;  // LED_NOTE / LED_CC pairs per sysex
    var MAX_QUADS_PER_MSG = 8;   // LED_RGB quads per sysex
    var MAX_TEXT_LEN = 48;

    var out = null;
    var connected = false;
    var sequenceSupported = false;
    var textLimit = 24; // capability bit 1 permits longer, scrolling labels
    var lastPongMs = 0;
    var pingSeq = 0;

    // Desired state (what modules asked for)
    var wantNote = [];   // note -> palette color
    var wantCC = [];     // cc -> palette color
    var wantRGB = [];    // idx -> [r7, g7, b7]
    var wantText = ["", "", "", ""];
    var wantSequence = null;
    var sentSequence = null;
    // Sent state (what the device has)
    var sentNote = [];
    var sentCC = [];
    var sentRGB = [];
    var sentText = [null, null, null, null];

    function hex2(v) {
        var s = v.toString(16);
        return s.length < 2 ? "0" + s : s;
    }

    function sendCmd(cmd, payloadBytes) {
        if (out === null) return;
        var msg = "f0" + HEADER + hex2(cmd);
        for (var i = 0; i < payloadBytes.length; i++) {
            msg += hex2(payloadBytes[i] & 0x7F);
        }
        msg += "f7";
        out.sendSysex(msg);
    }

    function markAllDirty() {
        sentNote = [];
        sentCC = [];
        sentRGB = [];
        sentText = [null, null, null, null];
        sentSequence = null;
    }

    function schedulePing() {
        host.scheduleTask(function () {
            sendCmd(0x00, [pingSeq]);
            if (!connected) sendCmd(0x7E, [PROTO_VERSION]);
            pingSeq = (pingSeq + 1) & 0x7F;
            if (connected && Date.now() - lastPongMs > LINK_TIMEOUT_MS) {
                connected = false;
                host.println("MoveProtocol: link to Move lost");
            }
            schedulePing();
        }, PING_INTERVAL_MS);
    }

    return {
        init: function (midiOut) {
            out = midiOut;
            sendCmd(0x7E, [PROTO_VERSION]); // HELLO
            schedulePing();
        },

        /** Feed sysex from onSysex0. Returns true if it was ours. */
        onSysex: function (data) {
            var msg = data.toLowerCase().replace(/\s+/g, "");
            if (msg.indexOf("f0" + HEADER) !== 0) return false;
            if (!/^f0(?:[0-7][0-9a-f])+f7$/.test(msg)) return true;
            // Layout: f0(0-1) header(2-7) cmd(8-9) payload(10..) f7
            var cmd = parseInt(msg.substr(8, 2), 16);
            if (cmd === 0x40) { // PONG
                if (msg.length !== 14) return true;
                lastPongMs = Date.now();
            } else if (cmd === 0x41) { // HELLO_ACK
                if (msg.length !== 14 && msg.length !== 16) return true;
                var ver = parseInt(msg.substr(10, 2), 16);
                if (ver !== PROTO_VERSION) {
                    connected = false;
                    sequenceSupported = false;
                    host.println("MoveProtocol: incompatible module; install matching release assets");
                    return true;
                }
                sequenceSupported = msg.length >= 16 && (parseInt(msg.substr(12, 2), 16) & 1) !== 0;
                textLimit = msg.length >= 16 && (parseInt(msg.substr(12, 2), 16) & 2) !== 0 ? 48 : 24;
                connected = true;
                lastPongMs = Date.now();
                host.println("MoveProtocol: handshake ok (module proto v" + ver + ")");
                markAllDirty();
                host.requestFlush();
            }
            return true;
        },

        isConnected: function () {
            return connected;
        },

        /** Optional protocol-v2 capability 1: bar overview (MoveSequencer.overview) or null. */
        sequence: function (values) { wantSequence = values; },

        /** Palette LED on a note address (pads 68-99, steps 16-31). */
        ledNote: function (note, color) {
            wantNote[note] = color & 0x7F;
        },

        /** Palette/brightness LED on a CC address (buttons). */
        ledCC: function (cc, color) {
            wantCC[cc] = color & 0x7F;
        },

        /**
         * Direct RGB LED — **CC-addressed RGB LEDs only** (track buttons 40-43,
         * Sample ring 118, knob rings 71-78). The RGB sysex index space is flat
         * and CC numbers own their slots, so pad notes 68-99 collide with knob/
         * transport LEDs (verified on hardware). Pads must use ledNote().
         * r/g/b as floats 0.0-1.0 (Bitwig color observer values).
         */
        ledRGB: function (idx, r, g, b) {
            var r7 = Math.max(0, Math.min(127, Math.round(r * 127)));
            var g7 = Math.max(0, Math.min(127, Math.round(g * 127)));
            var b7 = Math.max(0, Math.min(127, Math.round(b * 127)));
            wantRGB[idx] = (r7 << 14) | (g7 << 7) | b7; // pack for cheap compare
        },

        /** Display line 1-4. */
        text: function (line, str) {
            if (str === null || str === undefined) str = "";
            if (str.length > MAX_TEXT_LEN) str = str.substr(0, MAX_TEXT_LEN);
            wantText[line - 1] = str;
        },

        /** Ask the module to clear all LEDs (also resets our sent-cache). */
        clearAll: function () {
            sendCmd(0x05, []);
            wantNote = [];
            wantCC = [];
            wantRGB = [];
            markAllDirty();
        },

        /** Send all pending diffs. Call once from the script's flush(). */
        flush: function () {
            if (out === null || !connected) return;
            var payload, i, n;

            if (sequenceSupported) {
                var sequenceKey = wantSequence === null ? "" : wantSequence.join(",");
                if (sequenceKey !== sentSequence) {
                    sendCmd(0x07, wantSequence === null ? [] : wantSequence);
                    sentSequence = sequenceKey;
                }
            }

            // LED_NOTE diffs
            payload = [];
            for (n = 0; n < 128; n++) {
                if (wantNote[n] !== undefined && wantNote[n] !== sentNote[n]) {
                    payload.push(n, wantNote[n]);
                    sentNote[n] = wantNote[n];
                    if (payload.length >= MAX_PAIRS_PER_MSG * 2) {
                        sendCmd(0x02, payload);
                        payload = [];
                    }
                }
            }
            if (payload.length > 0) sendCmd(0x02, payload);

            // LED_CC diffs
            payload = [];
            for (n = 0; n < 128; n++) {
                if (wantCC[n] !== undefined && wantCC[n] !== sentCC[n]) {
                    payload.push(n, wantCC[n]);
                    sentCC[n] = wantCC[n];
                    if (payload.length >= MAX_PAIRS_PER_MSG * 2) {
                        sendCmd(0x03, payload);
                        payload = [];
                    }
                }
            }
            if (payload.length > 0) sendCmd(0x03, payload);

            // LED_RGB diffs
            payload = [];
            for (n = 0; n < 128; n++) {
                if (wantRGB[n] !== undefined && wantRGB[n] !== sentRGB[n]) {
                    var packed = wantRGB[n];
                    payload.push(n, (packed >> 14) & 0x7F, (packed >> 7) & 0x7F, packed & 0x7F);
                    sentRGB[n] = packed;
                    if (payload.length >= MAX_QUADS_PER_MSG * 4) {
                        sendCmd(0x04, payload);
                        payload = [];
                    }
                }
            }
            if (payload.length > 0) sendCmd(0x04, payload);

            // TEXT diffs
            for (i = 0; i < 4; i++) {
                if (wantText[i] !== sentText[i]) {
                    payload = [i];
                    for (n = 0; n < Math.min(wantText[i].length, textLimit); n++) {
                        var c = wantText[i].charCodeAt(n);
                        payload.push(c >= 32 && c <= 126 ? c : 63); // '?'
                    }
                    sendCmd(0x01, payload);
                    sentText[i] = wantText[i];
                }
            }
        }
    };
})();
