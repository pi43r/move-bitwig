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
                    // Sync: Bitwig ColorValue.red() etc. return numbers directly in v18+
                    color = MoveHardware.nearestColor(c.red(), c.green(), c.blue());


                    // State-based modifiers
                    if (slot.isRecording().get()) {
                        color = MoveHardware.COLOR.RED; // Override with bright red
                    } else if (slot.isPlaying().get()) {
                        // Keep color but maybe make it slightly brighter or pulse? 
                        // For now we use the raw palette index
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
                    if (shiftDown) {
                        slotBank.stop();
                    } else {
                        slotBank.getItemAt(cell.scene).launch();
                    }
                    return true;
                }
            }
        }
        return false;
    }
};
