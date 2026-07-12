/**
 * MoveGrid.js
 * Pad logic (notes 68-99) and clip launcher feedback.
 *
 * Pad LEDs use note-on + palette velocity (LED_NOTE), the same mechanism
 * Move's own firmware uses for pads. The RGB sysex (LED_RGB) is only valid
 * for CC-addressed RGB LEDs — its flat index space means pad notes 68-99
 * would collide with knob/transport CC LEDs (verified on hardware: pad
 * colors lit the knob rings).
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
                slot.color().markInterested();
            }
        }
    },

    /**
     * Write desired pad LED state (called from flush)
     */
    updateLEDs: function () {
        for (var t = 0; t < 8; t++) {
            var track = this.trackBank.getItemAt(t);
            var clipLauncher = track.clipLauncherSlotBank();

            for (var s = 0; s < 4; s++) {
                var slot = clipLauncher.getItemAt(s);
                var note = MoveHardware.getPadNote(t, s);
                var color = MoveHardware.COLOR.BLACK;

                if (slot.hasContent().get()) {
                    if (slot.isRecording().get()) {
                        color = MoveHardware.COLOR.RECORDING;
                    } else {
                        var c = slot.color();
                        // Full color when playing/queued, dimmed when stopped.
                        var dim = (slot.isPlaying().get() || slot.isPlaybackQueued().get())
                                ? 1.0 : 0.25;
                        color = MoveHardware.nearestColor(
                            c.red() * dim, c.green() * dim, c.blue() * dim);
                    }
                }

                MoveProtocol.ledNote(note, color);
            }
        }
    },

    /**
     * Handle physical pad input (called from onMidi0)
     */
    handleNote: function (status, note, velocity, modifiers) {
        if (note < MoveHardware.NOTES.PAD_FIRST || note > MoveHardware.NOTES.PAD_LAST) {
            return false;
        }

        var isNoteOn = (status & 0xF0) === 0x90 && velocity > 0;
        if (!isNoteOn) return true; // consume pad note-offs

        var cell = MoveHardware.getPadCoordinate(note);
        if (!cell) return true;

        var track = this.trackBank.getItemAt(cell.track);
        var slot = track.clipLauncherSlotBank().getItemAt(cell.scene);

        if (modifiers.del) {
            slot.deleteObject();
        } else if (modifiers.shift) {
            slot.select(); // manual parity: Shift+Pad selects the clip
        } else {
            slot.launch();
        }
        return true;
    }
};
