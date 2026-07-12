/**
 * MoveNavigation.js
 * Arrow keys, scrolling, device/track navigation, knobs, display content.
 */

var MoveNavigation = {
    trackBank: null,
    cursorTrack: null,
    cursorDevice: null,
    remoteControls: null,
    masterTrack: null,

    activeParameter: null,

    init: function (host) {
        this.trackBank = host.createMainTrackBank(8, 2, 4);
        this.cursorTrack = host.createCursorTrack(0, 0);
        this.cursorDevice = this.cursorTrack.createCursorDevice();
        this.remoteControls = this.cursorDevice.createCursorRemoteControlsPage(8);
        this.masterTrack = host.createMasterTrack(0);

        // Observers for OLED metadata
        this.cursorTrack.name().markInterested();
        this.cursorTrack.volume().name().markInterested();
        this.cursorTrack.volume().value().displayedValue().markInterested();
        this.cursorDevice.name().markInterested();
        this.masterTrack.volume().name().markInterested();
        this.masterTrack.volume().value().displayedValue().markInterested();

        for (var i = 0; i < 8; i++) {
            var rc = this.remoteControls.getParameter(i);
            rc.name().markInterested();
            rc.value().displayedValue().markInterested();
            rc.setIndication(true);
        }
    },

    /**
     * Write display content (called from flush)
     */
    updateDisplay: function () {
        var trackName = this.cursorTrack.name().get() || "No Track";
        var deviceName = this.cursorDevice.name().get() || "No Device";

        MoveProtocol.text(1, trackName);
        MoveProtocol.text(2, deviceName);

        if (this.activeParameter) {
            MoveProtocol.text(3, this.activeParameter.name().get());
            MoveProtocol.text(4, this.activeParameter.value().displayedValue().get());
        } else {
            MoveProtocol.text(3, "");
            MoveProtocol.text(4, "");
        }
    },

    /**
     * Handle physical CC input (called from onMidi0)
     */
    handleCC: function (cc, value, modifiers) {
        // Relative encoders send a 0 delta only as noise; buttons send 0 on release.
        if (value === 0) return false;

        if (cc === MoveHardware.CC.LEFT) {
            if (modifiers.shift) this.cursorDevice.selectPrevious();
            else this.trackBank.scrollBackwards();
            return true;
        }
        if (cc === MoveHardware.CC.RIGHT) {
            if (modifiers.shift) this.cursorDevice.selectNext();
            else this.trackBank.scrollForwards();
            return true;
        }
        if (cc === MoveHardware.CC.UP) {
            this.trackBank.sceneBank().scrollBackwards();
            return true;
        }
        if (cc === MoveHardware.CC.DOWN) {
            this.trackBank.sceneBank().scrollForwards();
            return true;
        }

        // Master (volume) knob: master track volume (manual parity).
        if (cc === MoveHardware.CC.MASTER) {
            var delta = MoveHardware.decodeDelta(value);
            var vol = this.masterTrack.volume();
            vol.inc(delta, modifiers.shift ? 512 : 128); // Shift = fine
            this.activeParameter = vol;
            host.requestFlush();
            return true;
        }

        // Jog wheel: track selection
        if (cc === MoveHardware.CC.JOG_WHEEL) {
            var jogDelta = MoveHardware.decodeDelta(value);
            if (jogDelta > 0) this.cursorTrack.selectNext();
            else if (jogDelta < 0) this.cursorTrack.selectPrevious();
            return true;
        }

        // Knobs 1-8: remote controls
        if (cc >= MoveHardware.CC.KNOB_FIRST && cc <= MoveHardware.CC.KNOB_LAST) {
            var knobIdx = cc - MoveHardware.CC.KNOB_FIRST;
            var rc = this.remoteControls.getParameter(knobIdx);
            var knobDelta = MoveHardware.decodeDelta(value);
            if (knobDelta !== 0) {
                rc.inc(knobDelta, modifiers.shift ? 512 : 128); // Shift = fine
                this.activeParameter = rc;
                host.requestFlush();
            }
            return true;
        }

        return false;
    },

    /**
     * Handle knob touches (notes 0-9)
     */
    handleTouch: function (status, note, velocity) {
        if (note > 9) return false;

        var isPress = ((status & 0xF0) === 0x90 && velocity > 0);
        if (isPress) {
            if (note <= 7) {
                this.activeParameter = this.remoteControls.getParameter(note);
            } else if (note === 8) {
                this.activeParameter = this.masterTrack.volume();
            }
            host.requestFlush();
        }
        // activeParameter intentionally stays after release ("sticky")
        return true;
    }
};
