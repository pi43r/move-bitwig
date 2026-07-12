/**
 * MoveGrid.js
 * SESSION mode: pads = 8x4 clip launcher, step buttons = track select/stop.
 *
 * Pad LEDs use note-on + palette velocity (LED_NOTE), the same mechanism
 * Move's own firmware uses for pads (the RGB sysex index space is CC-only).
 *
 * Step buttons (manual parity):
 *   odd steps (1,3,..,15)  select track 1-8
 *   even steps (2,4,..,14) stop the playing clip in track 1-7
 *   step 16                stop all clips
 */

var MoveGrid = {
    trackBank: null,

    init: function (host, trackBank) {
        this.trackBank = trackBank;
        this.trackBank.setShouldShowClipLauncherFeedback(true);

        for (var t = 0; t < 8; t++) {
            var track = this.trackBank.getItemAt(t);
            var clipLauncher = track.clipLauncherSlotBank();
            for (var s = 0; s < 4; s++) {
                var slot = clipLauncher.getItemAt(s);
                slot.hasContent().markInterested();
                slot.isPlaying().markInterested();
                slot.isRecording().markInterested();
                slot.isPlaybackQueued().markInterested();
                slot.isRecordingQueued().markInterested();
                slot.color().markInterested();
            }
        }
    },

    /**
     * Write desired pad + step LED state (called from flush in SESSION mode).
     * blinkPhase toggles ~3x/sec for queued-clip blinking.
     */
    updateLEDs: function (blinkPhase) {
        var t, track;

        // Pads
        for (t = 0; t < 8; t++) {
            track = this.trackBank.getItemAt(t);
            var clipLauncher = track.clipLauncherSlotBank();

            for (var s = 0; s < 4; s++) {
                var slot = clipLauncher.getItemAt(s);
                var note = MoveHardware.getPadNote(t, s);
                var color = MoveHardware.COLOR.BLACK;

                if (slot.isRecordingQueued().get()) {
                    color = blinkPhase ? MoveHardware.COLOR.RECORDING : MoveHardware.COLOR.DIM_RED;
                } else if (slot.hasContent().get()) {
                    if (slot.isRecording().get()) {
                        color = MoveHardware.COLOR.RECORDING;
                    } else {
                        var c = slot.color();
                        var queued = slot.isPlaybackQueued().get();
                        var bright = slot.isPlaying().get() || (queued && blinkPhase);
                        var dim = bright ? 1.0 : 0.25;
                        color = MoveHardware.nearestColor(
                            c.red() * dim, c.green() * dim, c.blue() * dim);
                    }
                }

                MoveProtocol.ledNote(note, color);
            }
        }

        // Step buttons: odd = track select (track color / white when selected),
        // even = stop buttons (dim), step 16 = stop all (dim red)
        for (var i = 0; i < 16; i++) {
            var stepNote = MoveHardware.NOTES.STEP_FIRST + i;
            var color2 = MoveHardware.COLOR.BLACK;

            if (i === 15) {
                color2 = MoveHardware.COLOR.DIM_RED; // stop all
            } else if (i % 2 === 0) { // odd-numbered button = select track i/2
                t = i / 2;
                track = this.trackBank.getItemAt(t);
                if (track.exists().get()) {
                    if (MoveNavigation.trackSelected[t]) {
                        color2 = MoveHardware.COLOR.WHITE;
                    } else {
                        var tc = track.color();
                        color2 = MoveHardware.nearestColor(
                            tc.red() * 0.3, tc.green() * 0.3, tc.blue() * 0.3);
                    }
                }
            } else { // even-numbered button = stop track (i-1)/2
                t = (i - 1) / 2;
                if (this.trackBank.getItemAt(t).exists().get()) {
                    color2 = MoveHardware.COLOR.HAS_CLIP; // dim white
                }
            }

            MoveProtocol.ledNote(stepNote, color2);
        }
    },

    /**
     * Handle physical pad/step input (called from onMidi0 in SESSION mode)
     */
    handleNote: function (status, note, velocity, modifiers) {
        var isNoteOn = (status & 0xF0) === 0x90 && velocity > 0;

        // Pads: clip launcher
        if (note >= MoveHardware.NOTES.PAD_FIRST && note <= MoveHardware.NOTES.PAD_LAST) {
            if (!isNoteOn) return true; // consume pad note-offs

            var cell = MoveHardware.getPadCoordinate(note);
            if (!cell) return true;

            var track = this.trackBank.getItemAt(cell.track);
            var slot = track.clipLauncherSlotBank().getItemAt(cell.scene);

            if (modifiers.del) {
                slot.deleteObject();
            } else if (modifiers.shift) {
                slot.select(); // manual parity: Shift+Pad selects the clip
            } else if (!slot.hasContent().get() && track.arm().get()) {
                slot.record(); // empty slot on armed track: record new clip
            } else {
                slot.launch();
            }
            return true;
        }

        // Step buttons: track select / clip stop
        if (note >= MoveHardware.NOTES.STEP_FIRST && note <= MoveHardware.NOTES.STEP_LAST) {
            if (!isNoteOn) return true;

            var i = note - MoveHardware.NOTES.STEP_FIRST;
            if (i === 15) {
                for (var t = 0; t < 8; t++) {
                    this.trackBank.getItemAt(t).stop(); // stop all
                }
            } else if (i % 2 === 0) {
                this.trackBank.getItemAt(i / 2).selectInEditor();
            } else {
                this.trackBank.getItemAt((i - 1) / 2).stop();
            }
            return true;
        }

        return false;
    }
};
