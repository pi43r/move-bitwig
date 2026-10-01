/**
 * MoveMixer.js
 * MIXER mode: knobs 1-8 = volumes of the 7-track window and Main, pad rows = per-track
 * toggles, step buttons keep their SESSION behavior (select/stop).
 *
 * Pad rows (top to bottom):
 *   row 1 (top)  record arm     red / dim red
 *   row 2        solo           yellow / dim
 *   row 3        mute           orange = muted / dim
 *   row 4 (bot)  select         white = selected, track color otherwise
 */

var MoveMixer = {
    trackBank: null,

    // Palette indices (see MoveHardware.PALETTE)
    COLOR_SOLO_ON: 7,    // vivid yellow
    COLOR_SOLO_OFF: 74,  // very dark yellow
    COLOR_MUTE_ON: 3,    // orange
    COLOR_MUTE_OFF: 76,  // very dark brown-yellow

    init: function (host, trackBank) {
        this.trackBank = trackBank;
        for (var t = 0; t < 8; t++) {
            var track = MoveNavigation.channelAt(t);
            track.solo().markInterested();
            track.volume().exists().markInterested();
            track.volume().name().markInterested();
            track.volume().value().markInterested();
            track.volume().value().displayedValue().markInterested();
            track.pan().exists().markInterested();
            track.pan().name().markInterested();
            track.pan().value().markInterested();
            track.pan().value().displayedValue().markInterested();
            // Sends layer (Copy held + knob; bank has 2 sends)
            for (var s = 0; t < 7 && s < 2; s++) {
                var send = track.sendBank().getItemAt(s);
                send.name().markInterested();
                send.value().markInterested();
                send.value().displayedValue().markInterested();
                send.exists().markInterested();
            }
            // exists/color/arm/mute/selected are observed by MoveNavigation
        }
    },

    /**
     * MIXER-mode CC handling: knobs 1-8 = track volumes.
     * Everything else falls through (master knob, wheel, arrows unchanged).
     */
    handleCC: function (cc, value, modifiers) {
        if (value === 0) return false;

        if (cc >= MoveHardware.CC.KNOB_FIRST && cc <= MoveHardware.CC.KNOB_LAST) {
            var idx = cc - MoveHardware.CC.KNOB_FIRST;
            var delta = MoveHardware.decodeDelta(value);
            var param = MoveNavigation.mixerParameter(idx, modifiers);
            if (delta !== 0 && param) {
                if (modifiers.mute) modifiers.muteUsed = true;
                // Shift selects send B in the sends layer, otherwise fine
                param.inc(delta, modifiers.shift && !modifiers.copy ? 512 : 128);
                MoveNavigation.focusParameter(param);
                host.requestFlush();
            }
            return true;
        }

        return false;
    },

    /**
     * MIXER-mode pad handling (steps fall through to MoveGrid).
     */
    handleNote: function (status, note, velocity, modifiers) {
        if (note < MoveHardware.NOTES.PAD_FIRST || note > MoveHardware.NOTES.PAD_LAST) {
            return false;
        }
        var isNoteOn = (status & 0xF0) === 0x90 && velocity > 0;
        if (!isNoteOn) return true;

        var cell = MoveHardware.getPadCoordinate(note);
        if (!cell) return true;

        var track = MoveNavigation.channelAt(cell.col);
        if (!track.exists().get() || (cell.col < 7 && MoveGrid.isMain(track))) return true;

        switch (cell.row) { // row 0 = top
            case 0: track.arm().toggle(); break;
            case 1: track.solo().toggle(); break;
            case 2: track.mute().toggle(); break;
            case 3: MoveNavigation.selectTrack(track); break;
        }
        return true;
    },

    /**
     * MIXER-mode knob rings: track color, brightness follows the volume
     * (replaces the remote-controls rings while in MIXER).
     */
    updateKnobLEDs: function () {
        for (var t = 0; t < 8; t++) {
            var track = MoveNavigation.channelAt(t);
            var r = 0, g = 0, b = 0;
            if (track.exists().get() && (t === 7 || !MoveGrid.isMain(track))) {
                var c = track.color();
                r = c.red(); g = c.green(); b = c.blue();
                if (r === 0 && g === 0 && b === 0) { r = 1; g = 1; b = 1; }
                var v = 0.08 + 0.72 * track.volume().value().get();
                r *= v; g *= v; b *= v;
            }
            MoveProtocol.ledRGB(MoveHardware.CC.KNOB_FIRST + t, r, g, b);
        }
    },

    /**
     * MIXER-mode pad LEDs (called from flush; steps come from MoveGrid).
     */
    updatePadLEDs: function () {
        for (var t = 0; t < 8; t++) {
            var track = MoveNavigation.channelAt(t);
            var exists = track.exists().get() && (t === 7 || !MoveGrid.isMain(track));

            var armColor = 0, soloColor = 0, muteColor = 0, selColor = 0;
            if (exists) {
                armColor = track.arm().get()
                    ? MoveHardware.COLOR.RED : MoveHardware.COLOR.DIM_RED;
                soloColor = track.solo().get()
                    ? this.COLOR_SOLO_ON : this.COLOR_SOLO_OFF;
                muteColor = track.mute().get()
                    ? this.COLOR_MUTE_ON : this.COLOR_MUTE_OFF;
                if (MoveNavigation.trackSelected[t]) {
                    selColor = MoveHardware.COLOR.WHITE;
                } else {
                    var c = track.color();
                    selColor = MoveHardware.nearestColor(
                        c.red() * 0.4, c.green() * 0.4, c.blue() * 0.4);
                }
            }

            MoveProtocol.ledNote(MoveHardware.getPadNote(t, 0), armColor);
            MoveProtocol.ledNote(MoveHardware.getPadNote(t, 1), soloColor);
            MoveProtocol.ledNote(MoveHardware.getPadNote(t, 2), muteColor);
            MoveProtocol.ledNote(MoveHardware.getPadNote(t, 3), selColor);
        }
    }
};
