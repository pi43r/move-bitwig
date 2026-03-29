/**
 * MoveHardware.js
 * Hardware definitions and decoding logic for the Ableton Move.
 */

var MoveHardware = {
    // CC constants
    CC: {
        PLAY: 85,
        REC: 86,
        SHIFT: 49,
        LEFT: 62,
        RIGHT: 63,
        UP: 55,
        DOWN: 54,
        JOG_WHEEL: 14,
        JOG_CLICK: 3,
        KNOB_FIRST: 71,
        KNOB_LAST: 78,
        MASTER: 79,
        MUTE: 88,
        DELETE: 119,
        CAPTURE: 52,
        MENU: 50,
        BACK: 51
    },

    // Note constants
    NOTES: {
        TOUCH_KNOB_FIRST: 0,
        TOUCH_KNOB_LAST: 7,
        STEP_FIRST: 16,
        STEP_LAST: 31,
        PAD_FIRST: 68,
        PAD_LAST: 99
    },

    // LED Colors (MIDI note/CC velocity values)
    COLOR: {
        BLACK: 0,
        WHITE: 120,
        LIGHT_GREY: 118,
        RED: 127,
        DIM_RED: 1,
        GREEN: 8,
        DIM_GREEN: 2,
        AMBER: 64,
        BLUE: 125,
        HAS_CLIP: 30, // dim white
        PLAYING: 8,
        RECORDING: 127,
        QUEUED: 64
    },

    // Helper to decode relative encoder bits
    decodeDelta: function(value) {
        if (value === 0) return 0;
        return value <= 63 ? value : value - 128;
    },

    // Helper to map pad note to Grid coordinate
    getPadCoordinate: function(note) {
        if (note >= 68 && note <= 99) {
            var offset = note - 68;
            var track = offset % 8;
            var row = Math.floor(offset / 8);
            var scene = 3 - row;
            return { track: track, scene: scene };
        }
        return null;
    },

    // Helper to get pad note from coordinate
    getPadNote: function(track, scene) {
        return 92 - (scene * 8) + track;
    },

    // 128-color palette for Ableton Move (Official from constants.mjs)
    PALETTE: [[0, 0, 0], [255, 36, 36], [242, 58, 12], [255, 153, 0], [166, 137, 86], [237, 249, 90], [193, 157, 8], [255, 255, 0], [86, 191, 19], [44, 132, 3], [36, 107, 36], [25, 255, 48], [21, 149, 115], [23, 107, 80], [0, 255, 255], [0, 116, 252], [39, 79, 204], [0, 68, 140], [100, 74, 217], [77, 63, 160], [135, 0, 255], [230, 87, 227], [102, 0, 153], [255, 0, 153], [161, 76, 95], [255, 77, 196], [235, 139, 225], [166, 52, 33], [153, 86, 40], [135, 103, 0], [144, 130, 31], [74, 135, 0], [0, 127, 18], [24, 83, 178], [98, 75, 173], [115, 58, 103], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [174, 255, 153], [124, 221, 159], [137, 180, 125], [128, 243, 255], [122, 206, 252], [104, 161, 211], [133, 143, 194], [187, 170, 242], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [77, 11, 11], [26, 4, 4], [77, 18, 4], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [77, 73, 31], [26, 24, 10], [64, 51, 2], [26, 21, 1], [77, 77, 0], [26, 26, 0], [28, 64, 7], [11, 26, 3], [17, 51, 1], [0, 0, 0], [17, 51, 17], [0, 0, 0], [10, 77, 10], [0, 0, 0], [7, 51, 39], [0, 0, 0], [16, 77, 57], [3, 13, 10], [0, 0, 0], [0, 0, 0], [0, 35, 77], [0, 0, 0], [12, 25, 64], [0, 0, 0], [0, 37, 77], [0, 0, 0], [35, 26, 77], [12, 9, 26], [37, 30, 77], [12, 10, 26], [0, 0, 0], [13, 0, 26], [77, 29, 76], [26, 10, 25], [51, 0, 77], [17, 0, 26], [77, 0, 46], [26, 0, 15], [77, 36, 45], [26, 12, 15], [77, 23, 59], [26, 8, 20], [77, 45, 73], [26, 15, 24], [0, 0, 0], [89, 89, 89], [26, 26, 26], [255, 255, 255], [89, 89, 89], [255, 255, 255], [89, 89, 89], [26, 26, 26], [0, 0, 255], [0, 255, 0], [255, 0, 0]],

    // Find the nearest color in the 128-color palette using Euclidean distance
    nearestColor: function(r, g, b) {
        var r1 = r * 255;
        var g1 = g * 255;
        var b1 = b * 255;

        // --- Color Overrides (Force standard Bitwig hues to official indices) ---
        // 1. Violet / Magenta Detection (Prevents 'Violet is Blue' issue)
        if (b > 0.6 && r > 0.4 && g < 0.5) return 21; // Hot Magenta
        if (b > 0.4 && r > 0.3 && r < 0.5 && g < 0.3) return 22; // Purple

        // 2. Pure Primary Hits (Fast Path)
        if (r > 0.9 && g < 0.1 && b < 0.1) return 127; // Pure Red
        if (g > 0.9 && r < 0.1 && b < 0.1) return 126; // Pure Green
        if (b > 0.9 && r < 0.1 && g < 0.1) return 125; // Pure Blue
        if (r > 0.9 && g > 0.9 && b > 0.9) return 120; // Pure White

        var minDistance = 10000000;
        var bestIndex = 0;

        for (var i = 0; i < this.PALETTE.length; i++) {
            var color = this.PALETTE[i];
            // Standard RGB Baseline
            var rd = r1 - color[0]; 
            var gd = g1 - color[1];
            var bd = b1 - color[2]; 
            var distance = rd * rd + gd * gd + bd * bd;

            if (distance < minDistance) {
                minDistance = distance;
                bestIndex = i;
            }
        }
        return bestIndex;
    }
};
