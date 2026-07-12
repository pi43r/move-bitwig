/**
 * MoveTransport.js
 * Transport logic (Play/Rec). LED feedback goes through MoveProtocol
 * (sysex), so no CC bridge and no feedback loops.
 */

var MoveTransport = {
    transport: null,
    application: null,

    init: function (host) {
        this.transport = host.createTransport();
        this.application = host.createApplication();
        this.transport.isPlaying().markInterested();
        this.transport.isArrangerRecordEnabled().markInterested();
        this.transport.isClipLauncherOverdubEnabled().markInterested();
    },

    /**
     * Write desired LED state (called from flush)
     */
    updateLEDs: function () {
        // CC LED values are palette indices (Play/Rec are RGB LEDs):
        // green when playing, red when recording.
        MoveProtocol.ledCC(MoveHardware.CC.PLAY,
            this.transport.isPlaying().get() ? MoveHardware.COLOR.GREEN : 0);
        MoveProtocol.ledCC(MoveHardware.CC.REC,
            this.transport.isArrangerRecordEnabled().get() ? MoveHardware.COLOR.RED : 0);
    },

    /**
     * Handle physical CC input (called from onMidi0)
     */
    handleCC: function (cc, value, modifiers) {
        if (value !== 127) return false; // react to push only

        if (cc === MoveHardware.CC.PLAY) {
            if (modifiers.shift) {
                this.transport.restart(); // Shift+Play: re-trigger
            } else {
                this.transport.isPlaying().toggle();
            }
            return true;
        }

        if (cc === MoveHardware.CC.REC) {
            if (modifiers.shift) {
                this.transport.isClipLauncherOverdubEnabled().toggle();
            } else {
                this.transport.isArrangerRecordEnabled().toggle();
            }
            return true;
        }

        if (cc === MoveHardware.CC.UNDO) {
            if (modifiers.shift) this.application.redo();
            else this.application.undo();
            return true;
        }

        return false;
    }
};
