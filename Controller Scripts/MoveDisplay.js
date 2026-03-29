/**
 * MoveDisplay.js
 * Text-over-CC protocol handler for the Move OLED.
 * 
 * Line buffers (0-3) map to line1-line4 in the ui.js module.
 * CC 110-113: Add characters.
 * CC 114: Commit.
 */

var MoveDisplay = (function() {
    var CC_TEXT_BASE = 110;
    var CC_COMMIT = 114;
    var currentLines = ["", "", "", ""];
    var isDirty = false;

    return {
        /**
         * Send text for a specific line (1-4).
         * @param {number} line Line index (1-indexed)
         * @param {string} text The text to send
         * @param {MIDIOutput} midiOut Bitwig MIDI output port
         */
        sendText: function(line, text, midiOut) {
            if (text == null) text = "";
            if (text === currentLines[line - 1]) return; // Optimisation: don't send if unchanged
            
            var cc = CC_TEXT_BASE + (line - 1);
            isDirty = true;

            // Signal start of line by sending 1
            midiOut.sendMidi(0xB0, cc, 1);

            for (var i = 0; i < text.length; i++) {
                var charCode = text.charCodeAt(i);
                if (charCode > 127) charCode = 63; // '?'
                midiOut.sendMidi(0xB0, cc, charCode);
            }

            currentLines[line - 1] = text;
        },

        /**
         * Commit all current line buffers to the display.
         */
        commit: function(midiOut) {
            if (!isDirty) return;
            midiOut.sendMidi(0xB0, CC_COMMIT, 1);
            isDirty = false;
        },

        /**
         * Clear all lines and commit.
         */
        clear: function(midiOut) {
            for (var i = 1; i <= 4; i++) {
                this.sendText(i, "", midiOut);
            }
            this.commit(midiOut);
        }
    };
})();
