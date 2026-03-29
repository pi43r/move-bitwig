/**
 * MoveGrid.js
 * Handles Pad logic (Notes 68-99) and Clip Launcher feedback.
 * Includes improved RGB color mapping.
 */

var MoveGrid = {
    trackBank: null,

    init: function (host, trackBank) {
        this.trackBank = trackBank;
        this.trackBank.setShouldShowClipLauncherFeedback(true); // Enable clip launcher selection rectangle

        // Observers for Clip Launcher
        for (var t = 0; t < 8; t++) {
            var track = this.trackBank.getItemAt(t);
            var clipLauncher = track.clipLauncherSlotBank();
            for (var s = 0; s < 4; s++) {
                var slot = clipLauncher.getItemAt(s);
                slot.hasContent().markInterested();
                slot.isPlaying().markInterested();
                slot.isRecording().markInterested();
                slot.color().markInterested();
            }
        }
    },

    /**
     * Update Pad LEDs (Called from flush)
     */
    updateLEDs: function (midiOut) {
        for (var t = 0; t < 8; t++) {
            var track = this.trackBank.getItemAt(t);
            var clipLauncher = track.clipLauncherSlotBank();

            for (var s = 0; s < 4; s++) {
                var slot = clipLauncher.getItemAt(s);
                var color = 0;

                if (slot.hasContent().get()) {
                    var c = slot.color();
                    var isPlaying = slot.isPlaying().get();
                    var isRecording = slot.isRecording().get();

                    if (isRecording) {
                        color = MoveHardware.COLOR.RED; // Bright Red for Recording
                    } else {
                        // Use dimming for non-playing clips
                        var dimFactor = isPlaying ? 1.0 : 0.2;
                        color = MoveHardware.nearestColor(c.red() * dimFactor, c.green() * dimFactor, c.blue() * dimFactor);
                    }
                }

                var note = MoveHardware.getPadNote(t, s);
                midiOut.sendMidi(0x90, note, color);
            }
        }
    },

    /**
     * Handle physical Note input (Called from onMidi0)
     */
    handleNote: function (status, note, velocity, shiftDown) {
        var isNoteOn = (status & 0xF0) === 0x90 && velocity > 0;
        if (!isNoteOn) return false;

        if (note >= MoveHardware.NOTES.PAD_FIRST && note <= MoveHardware.NOTES.PAD_LAST) {
            // Ignore low-velocity "echoes"
            if (velocity > 1) {
                var cell = MoveHardware.getPadCoordinate(note);
                if (cell) {
                    var track = this.trackBank.getItemAt(cell.track);
                    var slotBank = track.clipLauncherSlotBank();
                    var slot = slotBank.getItemAt(cell.scene);

                    if (deleteDown) {
                        slot.deleteObject();
                    } else if (shiftDown) {
                        slotBank.stop();
                    } else {
                        slot.launch();
                    }
                    return true;
                }
            }
        }
        return false;
    }
};
