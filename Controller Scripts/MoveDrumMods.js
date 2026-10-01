/**
 * MoveDrumMods.js
 * Drum mode, right 4x4 pads: sixteen note-expression modifiers.
 *
 * Each pad holds one value (the "pen"), shown by its color: dim at the
 * default, brighter the further it is moved.
 *   hold pad + wheel        change the value (Shift = fine)
 *   hold pad + step         apply the value to the selected drum's note there
 *   hold step + tap pad     same, from the other side
 *   double-tap pad          reset to default
 *
 * Pad layout, most used first (top row, left to right):
 *   Velocity    Length       Chance        Repeat       groove basics
 *   Condition   Every N      Vel spread    Transpose     variation
 *   Pan         Gain         Timbre        Pressure      sound
 *   Release vel Rpt vel end  Rpt curve     Rpt vel curve repeat shape
 * Muting one step's note is Mute + step (MoveNotes), not a modifier.
 */

var MoveDrumMods = {
    held: -1,
    values: [],
    lastTap: -1,
    lastTapTime: 0,
    DOUBLE_TAP_MS: 350,
    CONDITIONS: ["Always", "First", "Not first", "Prev", "Not prev", "Prev chan",
        "Not prev chan", "Prev key", "Not prev key", "Fill", "Not fill"],
    occurrences: null,

    // min/max/def in display units; set/get convert to Bitwig's NoteStep units.
    MODS: [
        // Row 1: groove basics
        { name: "Velocity", min: 1, max: 127, def: 100, rgb: [1, 0.4, 0],
            get: function (s) { return Math.round(s.velocity() * 127); },
            set: function (s, v) { s.setVelocity(v / 127); } },
        { name: "Length", min: 1, max: 16, def: 1, rgb: [1, 1, 0.4],
            fmt: function (v) { return v + (v === 1 ? " step" : " steps"); },
            get: function (s) { return Math.max(1, Math.round(s.duration() / MoveSequencer.stepSize())); },
            set: function (s, v) { s.setDuration(v * MoveSequencer.stepSize()); } },
        { name: "Chance", min: 0, max: 100, def: 100, unit: "%", rgb: [1, 0.9, 0],
            get: function (s) { return s.isChanceEnabled() ? Math.round(s.chance() * 100) : 100; },
            set: function (s, v) { s.setChance(v / 100); s.setIsChanceEnabled(v < 100); } },
        { name: "Repeat", min: 0, max: 16, def: 0, rgb: [0, 0.9, 1],
            fmt: function (v) { return v === 0 ? "Off" : v + "x"; },
            get: function (s) { return s.isRepeatEnabled() ? s.repeatCount() : 0; },
            set: function (s, v) { s.setRepeatCount(v); s.setIsRepeatEnabled(v > 0); } },
        // Row 2: variation
        { name: "Condition", min: 0, max: 10, def: 0, rgb: [0.6, 0.3, 1],
            fmt: function (v) { return MoveDrumMods.CONDITIONS[v]; },
            get: function (s) { return s.isOccurrenceEnabled() ? s.occurrence().ordinal() : 0; },
            set: function (s, v) {
                s.setOccurrence(MoveDrumMods.occurrences[v]);
                s.setIsOccurrenceEnabled(v > 0);
            } },
        { name: "Every N", min: 1, max: 8, def: 1, rgb: [0.6, 0, 1],
            fmt: function (v) { return v === 1 ? "Off" : "1st of " + v; },
            get: function (s) { return s.isRecurrenceEnabled() ? s.recurrenceLength() : 1; },
            set: function (s, v) { s.setRecurrence(v, 1); s.setIsRecurrenceEnabled(v > 1); } },
        { name: "Vel spread", min: 0, max: 100, def: 0, unit: "%", rgb: [1, 0.6, 0.2],
            get: function (s) { return Math.round(s.velocitySpread() * 100); },
            set: function (s, v) { s.setVelocitySpread(v / 100); } },
        { name: "Transpose", min: -24, max: 24, def: 0, unit: " st", rgb: [0.2, 0.6, 1],
            get: function (s) { return Math.round(s.transpose()); },
            set: function (s, v) { s.setTranspose(v); } },
        // Row 3: sound
        { name: "Pan", min: -100, max: 100, def: 0, step: 2, rgb: [0, 0.4, 1],
            get: function (s) { return Math.round(s.pan() * 100); },
            set: function (s, v) { s.setPan(v / 100); } },
        { name: "Gain", min: 0, max: 100, def: 50, unit: "%", rgb: [1, 1, 1],
            get: function (s) { return Math.round(s.gain() * 100); },
            set: function (s, v) { s.setGain(v / 100); } },
        { name: "Timbre", min: -100, max: 100, def: 0, step: 2, rgb: [0.3, 1, 0.3],
            get: function (s) { return Math.round(s.timbre() * 100); },
            set: function (s, v) { s.setTimbre(v / 100); } },
        { name: "Pressure", min: 0, max: 100, def: 0, unit: "%", rgb: [1, 0, 0.6],
            get: function (s) { return Math.round(s.pressure() * 100); },
            set: function (s, v) { s.setPressure(v / 100); } },
        // Row 4: release and repeat shape
        { name: "Release vel", min: 0, max: 127, def: 64, rgb: [0.8, 0.4, 0.2],
            get: function (s) { return Math.round(s.releaseVelocity() * 127); },
            set: function (s, v) { s.setReleaseVelocity(v / 127); } },
        { name: "Rpt vel end", min: -100, max: 100, def: 0, step: 2, rgb: [0, 0.8, 0.5],
            get: function (s) { return Math.round(s.repeatVelocityEnd() * 100); },
            set: function (s, v) { s.setRepeatVelocityEnd(v / 100); } },
        { name: "Rpt curve", min: -100, max: 100, def: 0, step: 2, rgb: [0, 0.6, 0.6],
            get: function (s) { return Math.round(s.repeatCurve() * 100); },
            set: function (s, v) { s.setRepeatCurve(v / 100); } },
        { name: "Rpt vel curve", min: -100, max: 100, def: 0, step: 2, rgb: [0.2, 0.5, 0.4],
            get: function (s) { return Math.round(s.repeatVelocityCurve() * 100); },
            set: function (s, v) { s.setRepeatVelocityCurve(v / 100); } }
    ],

    init: function () {
        // Like CursorDeviceFollowMode, GraalJS needs the real Java enum constants.
        this.occurrences = Java.type("com.bitwig.extension.controller.api.NoteOccurrence").values();
        for (var i = 0; i < this.MODS.length; i++) this.values[i] = this.MODS[i].def;
    },

    /** Modifier index for pad index 0-31 (0 = bottom-left), or -1 on the drum half. */
    indexForPad: function (p) {
        var col = p % 8;
        if (col < 4) return -1;
        return (3 - Math.floor(p / 8)) * 4 + (col - 4);
    },

    press: function (index) {
        var now = Date.now();
        if (index === this.lastTap && now - this.lastTapTime < this.DOUBLE_TAP_MS) {
            this.values[index] = this.MODS[index].def;
            MoveNavigation.toast(this.MODS[index].name + " reset");
            this.lastTap = -1;
        } else {
            this.lastTap = index;
            this.lastTapTime = now;
        }
        this.held = index;
    },

    release: function (index) {
        if (this.held === index) this.held = -1;
    },

    /** Wheel while a pad is held. Returns the new value. */
    turn: function (delta, fine) {
        var mod = this.MODS[this.held];
        var step = fine ? 1 : (mod.step || 1) * (mod.max - mod.min > 50 ? 2 : 1);
        var v = Math.max(mod.min, Math.min(mod.max, this.values[this.held] + delta * step));
        this.values[this.held] = v;
        return v;
    },

    apply: function (noteStep, index) {
        this.MODS[index].set(noteStep, this.values[index]);
    },

    isDefault: function (noteStep, index) {
        return this.MODS[index].get(noteStep) === this.MODS[index].def;
    },

    label: function (index, value) {
        var mod = this.MODS[index];
        if (value === undefined) value = this.values[index];
        if (mod.fmt) return mod.fmt(value);
        if (mod.min < 0 && value > 0) return "+" + value + (mod.unit || "");
        return value + (mod.unit || "");
    },

    color: function (index) {
        if (index === this.held) return MoveHardware.COLOR.WHITE;
        var mod = this.MODS[index];
        var span = Math.max(mod.max - mod.def, mod.def - mod.min);
        var k = this.values[index] === mod.def ? 0.15
            : 0.35 + 0.65 * Math.abs(this.values[index] - mod.def) / span;
        return MoveHardware.nearestColor(mod.rgb[0] * k, mod.rgb[1] * k, mod.rgb[2] * k)
            || MoveHardware.COLOR.HAS_CLIP;
    },

    /** Step LED while a modifier is held: its color where a note has a non-default value. */
    stepColor: function (noteStep) {
        if (!noteStep) return MoveHardware.COLOR.BLACK;
        if (this.isDefault(noteStep, this.held)) return MoveHardware.COLOR.HAS_CLIP;
        var rgb = this.MODS[this.held].rgb;
        return MoveHardware.nearestColor(rgb[0], rgb[1], rgb[2]);
    }
};
