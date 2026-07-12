/**
 * MoveTrackControls.js
 * Track buttons 1-4 (manual parity: select tracks), Mute/Solo, Record Arm.
 *
 * Track button gestures (buttons map to bank tracks 1-4):
 *   press            select track   (double-press: toggle arm)
 *   Shift + press    launch scene 1-4 (former behavior)
 *   Mute held        mute/unmute that track
 *   Delete held      delete track
 *   Copy held        duplicate track
 *   held + Volume    adjust that track's volume (handled in MoveNavigation)
 *
 * Mute button: tap = mute selected track (Shift+tap = solo); holding it and
 * pressing another control uses it as a modifier instead (no mute toggle).
 */

var MoveTrackControls = {
    cursorTrack: null,
    sceneBank: null,
    trackBank: null,

    heldTrack: -1,          // track button currently held (-1 = none)
    lastPressMs: [0, 0, 0, 0],
    muteShiftAtPress: false,

    DOUBLE_PRESS_MS: 350,

    init: function (host, cursorTrack, sceneBank, trackBank) {
        this.cursorTrack = cursorTrack;
        this.sceneBank = sceneBank;
        this.trackBank = trackBank;

        this.cursorTrack.mute().markInterested();
        this.cursorTrack.solo().markInterested();
        this.cursorTrack.arm().markInterested();

        for (var i = 0; i < 4; i++) {
            var scene = this.sceneBank.getItemAt(i);
            scene.color().markInterested();
            scene.exists().markInterested();
        }
        // Per-track observers (exists/color/arm/selected) are registered by
        // MoveNavigation on the shared trackBank.
    },

    /**
     * Write desired LED state (called from flush)
     */
    updateLEDs: function () {
        // 1. Mute button (white LED): lit when selected track muted or soloed
        var lit = this.cursorTrack.mute().get() || this.cursorTrack.solo().get();
        MoveProtocol.ledCC(MoveHardware.CC.MUTE, lit ? 127 : 0);

        // 2. Track buttons 1-4 (RGB, idx = CC 43..40):
        //    white = selected, red = armed, track color otherwise
        for (var i = 0; i < 4; i++) {
            var cc = MoveHardware.CC.TRACK_SELECT_1 - i; // 43, 42, 41, 40
            var track = this.trackBank.getItemAt(i);
            if (!track.exists().get()) {
                MoveProtocol.ledRGB(cc, 0, 0, 0);
            } else if (track.arm().get()) {
                MoveProtocol.ledRGB(cc, 1.0, 0, 0);
            } else if (MoveNavigation.trackSelected[i]) {
                MoveProtocol.ledRGB(cc, 1.0, 1.0, 1.0);
            } else {
                var c = track.color();
                MoveProtocol.ledRGB(cc, c.red() * 0.4, c.green() * 0.4, c.blue() * 0.4);
            }
        }

        // 3. Record Arm on the Sample button RGB ring (idx = CC 118)
        var armed = this.cursorTrack.arm().get();
        MoveProtocol.ledRGB(MoveHardware.CC.SAMPLE, armed ? 1.0 : 0, 0, 0);
    },

    /**
     * Handle physical CC input (called from onMidi0).
     * Needs both presses (127) and releases (0).
     */
    handleCC: function (cc, value, modifiers) {
        // --- Mute: tap = action, hold = modifier -------------------------
        if (cc === MoveHardware.CC.MUTE) {
            if (value === 127) {
                modifiers.mute = true;
                modifiers.muteUsed = false;
                this.muteShiftAtPress = modifiers.shift;
            } else if (value === 0) {
                if (modifiers.mute && !modifiers.muteUsed) {
                    if (this.muteShiftAtPress || modifiers.shift) {
                        this.cursorTrack.solo().toggle();
                    } else {
                        this.cursorTrack.mute().toggle();
                    }
                }
                modifiers.mute = false;
                modifiers.muteUsed = false;
            }
            return true;
        }

        // --- Track buttons (CC 43..40 = tracks 1..4) ---------------------
        if (cc >= MoveHardware.CC.TRACK_SELECT_4 && cc <= MoveHardware.CC.TRACK_SELECT_1) {
            var idx = MoveHardware.CC.TRACK_SELECT_1 - cc; // 43 -> 0 ... 40 -> 3

            if (value === 0) { // release
                if (this.heldTrack === idx) this.heldTrack = -1;
                return true;
            }

            var track = this.trackBank.getItemAt(idx);

            if (modifiers.shift) {
                this.sceneBank.getItemAt(idx).launch(); // Shift+Track = scene
                return true;
            }
            if (modifiers.del) {
                track.deleteObject();
                return true;
            }
            if (modifiers.copy) {
                track.duplicate();
                return true;
            }
            if (modifiers.mute) {
                track.mute().toggle();
                modifiers.muteUsed = true;
                return true;
            }

            // Plain press: select; double-press: toggle arm
            this.heldTrack = idx;
            var now = Date.now();
            if (now - this.lastPressMs[idx] < this.DOUBLE_PRESS_MS) {
                track.arm().toggle();
            } else {
                track.selectInEditor();
            }
            this.lastPressMs[idx] = now;
            return true;
        }

        if (value === 0) return false;

        // --- Record Arm (Sample button) ----------------------------------
        if (cc === MoveHardware.CC.SAMPLE) {
            this.cursorTrack.arm().toggle();
            return true;
        }

        return false;
    }
};
