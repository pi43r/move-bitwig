/**
 * MoveTransport.js
 * Handles Transport logic (Play/Rec) using the "Middleman CC" strategy.
 */

var MoveTransport = {
    transport: null,

    init: function(host) {
        this.transport = host.createTransport();
        this.transport.isPlaying().markInterested();
        this.transport.isArrangerRecordEnabled().markInterested();
    },

    /**
     * Update transport LEDs (Called from flush)
     */
    updateLEDs: function(midiOut) {
        // Use Virtual CCs 100/101 for the Middleman Bridge
        midiOut.sendMidi(0xB0, 100, this.transport.isPlaying().get() ? MoveHardware.COLOR.GREEN : 0);
        midiOut.sendMidi(0xB0, 101, this.transport.isArrangerRecordEnabled().get() ? MoveHardware.COLOR.RED : 0);
    },

    /**
     * Handle physical CC input (Called from onMidi0)
     */
    handleCC: function (cc, value, shiftDown) {
        if (value === 127) { // Only react to PUSH
            if (cc === MoveHardware.CC.PLAY) {
                this.transport.isPlaying().toggle();
                return true;
            } else if (cc === MoveHardware.CC.REC) {
                this.transport.isArrangerRecordEnabled().toggle();
                return true;
            }
        }
        return false;
    }
};
