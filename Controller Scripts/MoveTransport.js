/**
 * MoveTransport.js
 * Transport logic (Play/Rec). LED feedback goes through MoveProtocol
 * (sysex), so no CC bridge and no feedback loops.
 */

var MoveTransport = {
    transport: null,
    application: null,
    groove: null,

    init: function (host) {
        this.transport = host.createTransport();
        this.application = host.createApplication();
        this.transport.isPlaying().markInterested();
        this.transport.isArrangerRecordEnabled().markInterested();
        this.transport.isClipLauncherOverdubEnabled().markInterested();
        this.transport.isMetronomeEnabled().markInterested();
        this.transport.isArrangerLoopEnabled().markInterested();
        this.transport.tempo().displayedValue().markInterested();
        this.groove = host.createGroove();
        this.groove.getEnabled().markInterested();
    },

    /** Shift+Step 7: global groove on/off. Returns the new state. */
    toggleGroove: function () {
        var on = this.groove.getEnabled().get() > 0.5;
        this.groove.getEnabled().set(on ? 0 : 1);
        return !on;
    },

    /** Loop tap (no gesture used while held): arranger loop on/off. */
    toggleArrangerLoop: function () {
        this.transport.isArrangerLoopEnabled().toggle();
        MoveNavigation.toast(this.transport.isArrangerLoopEnabled().get()
            ? "Arranger loop off" : "Arranger loop on"); // value not yet flipped
    },

    /**
     * Write desired LED state (called from flush)
     */
    updateLEDs: function () {
        // CC LED values are palette indices (Play/Rec are RGB LEDs):
        // green when playing, red when recording.
        MoveProtocol.ledCC(MoveHardware.CC.PLAY,
            this.transport.isPlaying().get() ? MoveHardware.COLOR.GREEN : 0);
        // Rec follows what plain Rec toggles in the current mode (F21):
        // launcher overdub in NOTE mode, arranger record elsewhere.
        var recOn = (ui.mode === "note")
            ? this.transport.isClipLauncherOverdubEnabled().get()
            : this.transport.isArrangerRecordEnabled().get();
        MoveProtocol.ledCC(MoveHardware.CC.REC, recOn ? MoveHardware.COLOR.RED : 0);
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
            // F21: NOTE mode records pad playing into the clip (launcher
            // overdub); Shift swaps to the other record target.
            var overdub = (ui.mode === "note") !== modifiers.shift;
            if (overdub) {
                this.transport.isClipLauncherOverdubEnabled().toggle();
                MoveNavigation.toast(this.transport.isClipLauncherOverdubEnabled().get()
                    ? "Overdub off" : "Overdub on"); // observer not yet flipped
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

        if (cc === MoveHardware.CC.CAPTURE) {
            if (modifiers.shift) {
                // Shift+Capture: browse to add a device after the current one
                MoveBrowser.addDevice();
                return true;
            }
            // Bitwig has no Capture-MIDI API; Capture = tap tempo instead.
            this.transport.tapTempo();
            MoveNavigation.toast("Tap: " + this.transport.tempo().displayedValue().get());
            return true;
        }

        return false;
    }
};
