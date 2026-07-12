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
        BACK: 51,
        UNDO: 56,
        LOOP: 58,
        COPY: 60,
        TRACK_SELECT_1: 43,
        TRACK_SELECT_2: 42,
        TRACK_SELECT_3: 41,
        TRACK_SELECT_4: 40,
        SAMPLE: 118
    },

    // Note constants
    NOTES: {
        TOUCH_KNOB_FIRST: 0,
        TOUCH_KNOB_LAST: 9,
        STEP_FIRST: 16,
        STEP_LAST: 31,
        PAD_FIRST: 68,
        PAD_LAST: 99
    },

    // LED Colors (palette indices, sent as note velocity / CC value)
    // Palette ends with: 125 = pure blue, 126 = pure green, 127 = pure red.
    COLOR: {
        BLACK: 0,
        WHITE: 120,
        LIGHT_GREY: 118,
        RED: 127,
        DIM_RED: 1,
        GREEN: 126,
        BRIGHT_GREEN: 8,
        AMBER: 64,
        BLUE: 125,
        HAS_CLIP: 30, // dim white
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

    // Perceptual (Oklab) palette matching. Set to false to fall back to the
    // old Euclidean-RGB matcher if colors look worse on hardware.
    USE_OKLAB: true,
    _oklabPalette: null,
    _searchIdx: null,   // palette indices worth searching (placeholders excluded)

    // The palette table has many [0,0,0] placeholder rows (unknown hardware
    // entries). Matching against them would snap dim colors to "black-ish"
    // indices with unknown LED results, so only index 0 represents black.
    _buildSearchIndex: function () {
        this._searchIdx = [0];
        for (var i = 1; i < this.PALETTE.length; i++) {
            var p = this.PALETTE[i];
            if (p[0] !== 0 || p[1] !== 0 || p[2] !== 0) this._searchIdx.push(i);
        }
    },

    _srgbToOklab: function (r, g, b) {
        // r/g/b as floats 0..1
        function lin(c) {
            return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        }
        var lr = lin(r), lg = lin(g), lb = lin(b);
        var l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
        var m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
        var s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
        return [
            0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
        ];
    },

    // Find the nearest color in the 128-color palette.
    nearestColor: function (r, g, b) {
        // Pure primary fast paths (exact hardware primaries at the palette tail)
        if (r > 0.9 && g < 0.1 && b < 0.1) return 127; // Pure Red
        if (g > 0.9 && r < 0.1 && b < 0.1) return 126; // Pure Green
        if (b > 0.9 && r < 0.1 && g < 0.1) return 125; // Pure Blue
        if (r > 0.9 && g > 0.9 && b > 0.9) return 120; // Pure White

        if (this._searchIdx === null) this._buildSearchIndex();
        var k, i, minDistance = Infinity, bestIndex = 0;

        if (this.USE_OKLAB) {
            if (this._oklabPalette === null) {
                this._oklabPalette = [];
                for (i = 0; i < this.PALETTE.length; i++) {
                    var p = this.PALETTE[i];
                    this._oklabPalette[i] =
                        this._srgbToOklab(p[0] / 255, p[1] / 255, p[2] / 255);
                }
            }
            var lab = this._srgbToOklab(r, g, b);
            for (k = 0; k < this._searchIdx.length; k++) {
                i = this._searchIdx[k];
                var q = this._oklabPalette[i];
                var dl = lab[0] - q[0], da = lab[1] - q[1], db2 = lab[2] - q[2];
                var d = dl * dl + da * da + db2 * db2;
                if (d < minDistance) {
                    minDistance = d;
                    bestIndex = i;
                }
            }
            return bestIndex;
        }

        // Legacy Euclidean RGB
        var r1 = r * 255, g1 = g * 255, b1 = b * 255;
        for (k = 0; k < this._searchIdx.length; k++) {
            i = this._searchIdx[k];
            var color = this.PALETTE[i];
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
