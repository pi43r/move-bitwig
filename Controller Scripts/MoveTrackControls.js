/**
 * MoveTrackControls.js
 * Track Selectors (launch scenes), Mute/Solo, Record Arm.
 * All LED feedback goes through MoveProtocol (sysex).
 */

var MoveTrackControls = {
    cursorTrack: null,
    sceneBank: null,

    init: function (host, cursorTrack, sceneBank) {
        this.cursorTrack = cursorTrack;
        this.sceneBank = sceneBank;

        this.cursorTrack.mute().markInterested();
        this.cursorTrack.solo().markInterested();
        this.cursorTrack.arm().markInterested();

        for (var i = 0; i < 4; i++) {
            var scene = this.sceneBank.getItemAt(i);
            scene.color().markInterested();
            scene.exists().markInterested();
        }
    },

    /**
     * Write desired LED state (called from flush)
     */
    updateLEDs: function () {
        // 1. Mute button (white LED): lit when muted or soloed
        var lit = this.cursorTrack.mute().get() || this.cursorTrack.solo().get();
        MoveProtocol.ledCC(MoveHardware.CC.MUTE, lit ? 127 : 0);

        // 2. Track buttons 1-4 show scene colors (RGB, idx = CC 43..40)
        for (var i = 0; i < 4; i++) {
            var scene = this.sceneBank.getItemAt(i);
            var cc = MoveHardware.CC.TRACK_SELECT_1 - i; // 43, 42, 41, 40
            if (scene.exists().get()) {
                var c = scene.color();
                MoveProtocol.ledRGB(cc, c.red(), c.green(), c.blue());
            } else {
                MoveProtocol.ledRGB(cc, 0.08, 0.08, 0.08); // dim white = empty
            }
        }

        // 3. Record Arm on the Sample button RGB ring (idx = CC 118)
        var armed = this.cursorTrack.arm().get();
        MoveProtocol.ledRGB(MoveHardware.CC.SAMPLE, armed ? 1.0 : 0, 0, 0);
    },

    /**
     * Handle physical CC input (called from onMidi0)
     */
    handleCC: function (cc, value, modifiers) {
        if (value === 0) return false;

        // Mute / Solo
        if (cc === MoveHardware.CC.MUTE) {
            if (modifiers.shift) this.cursorTrack.solo().toggle();
            else this.cursorTrack.mute().toggle();
            return true;
        }

        // Scene Launch (Track Selector buttons)
        if (cc >= MoveHardware.CC.TRACK_SELECT_4 && cc <= MoveHardware.CC.TRACK_SELECT_1) {
            var sceneIdx = MoveHardware.CC.TRACK_SELECT_1 - cc; // 43 -> 0 ... 40 -> 3
            this.sceneBank.getItemAt(sceneIdx).launch();
            return true;
        }

        // Record Arm (Sample button)
        if (cc === MoveHardware.CC.SAMPLE) {
            this.cursorTrack.arm().toggle();
            return true;
        }

        return false;
    }
};
