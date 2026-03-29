/**
 * MoveTrackControls.js
 * Handles Track Selectors (Launch Scenes) and Track state (Mute/Solo).
 */

var MoveTrackControls = {
    cursorTrack: null,
    sceneBank: null,

    init: function (host, cursorTrack, sceneBank) {
        this.cursorTrack = cursorTrack;
        this.sceneBank = sceneBank;

        // Observers for Mute/Solo
        this.cursorTrack.mute().markInterested();
        this.cursorTrack.solo().markInterested();

        // Observers for Scenes (to show track button colors)
        for (var i = 0; i < 4; i++) {
            var scene = this.sceneBank.getItemAt(i);
            scene.color().markInterested();
            scene.exists().markInterested();
        }

        // Observer for Record Arm
        this.cursorTrack.arm().markInterested();
    },

    /**
     * Update LED feedback (Called from flush)
     */
    updateLEDs: function (midiOut) {
        // 1. Mute LED feedback
        var isMuted = this.cursorTrack.mute().get();
        var isSoloed = this.cursorTrack.solo().get();

        // Adjust for White-only LED on Mute button
        if (isSoloed) {
            midiOut.sendMidi(0xB0, 102, MoveHardware.COLOR.WHITE); // Bright for Solo
        } else if (isMuted) {
            midiOut.sendMidi(0xB0, 102, MoveHardware.COLOR.WHITE); // Bright for Muted
        } else {
            midiOut.sendMidi(0xB0, 102, MoveHardware.COLOR.BLACK); // Off when active
        }

        // 2. Track Selectors (Scene colors) via Middleman Bridge (103-106)
        for (var i = 0; i < 4; i++) {
            var scene = this.sceneBank.getItemAt(i);
            var bridgeCC = 103 + i; // Track 1 -> 103, Track 2 -> 104, etc.

            if (scene.exists().get()) {
                var c = scene.color();
                var color = MoveHardware.nearestColor(c.red(), c.green(), c.blue());
                midiOut.sendMidi(0xB0, bridgeCC, color);
            } else {
                midiOut.sendMidi(0xB0, bridgeCC, MoveHardware.COLOR.HAS_CLIP); // Dim white / ready
            }
        }

        // 3. Record Arm (Sample button Bridge 107 -> Note 118)
        var isArmed = this.cursorTrack.arm().get();
        midiOut.sendMidi(0xB0, 107, isArmed ? MoveHardware.COLOR.RED : MoveHardware.COLOR.BLACK);
    },

    /**
     * Handle physical CC input (Called from onMidi0)
     */
    handleCC: function (cc, value, shiftDown) {
        if (value === 0) return false;

        // Mute / Solo
        if (cc === MoveHardware.CC.MUTE) {
            if (shiftDown) {
                this.cursorTrack.solo().toggle();
            } else {
                this.cursorTrack.mute().toggle();
            }
            return true;
        }

        // Scene Launch (Track Selectors)
        if (cc >= MoveHardware.CC.TRACK_SELECT_4 && cc <= MoveHardware.CC.TRACK_SELECT_1) {
            var sceneIdx = 43 - cc; // 43 -> 0, 42 -> 1, 41 -> 2, 40 -> 3
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
