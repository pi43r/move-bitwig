/**
 * MoveNavigation.js
 * Handles Arrow keys, Scrolling, and Device/Track navigation.
 */

var MoveNavigation = {
    trackBank: null,
    cursorTrack: null,
    cursorDevice: null,
    remoteControls: null,

    activeParameter: null,

    init: function(host) {
        this.trackBank = host.createMainTrackBank(8, 2, 4);
        this.cursorTrack = host.createCursorTrack(0, 0);
        this.cursorDevice = this.cursorTrack.createCursorDevice();
        this.remoteControls = this.cursorDevice.createCursorRemoteControlsPage(8);

        // Observers for OLED metadata
        this.cursorTrack.name().markInterested();
        this.cursorTrack.volume().name().markInterested();
        this.cursorTrack.volume().value().displayedValue().markInterested();
        this.cursorDevice.name().markInterested();
        
        for (var i = 0; i < 8; i++) {
            var rc = this.remoteControls.getParameter(i);
            rc.name().markInterested();
            rc.value().displayedValue().markInterested();
            rc.setIndication(true);
        }
    },

    /**
     * Update navigation state and OLED metadata (Called from flush)
     */
    updateDisplay: function(midiOut) {
        var trackName = this.cursorTrack.name().get() || "No Track";
        var deviceName = this.cursorDevice.name().get() || "No Device";
        
        MoveDisplay.sendText(1, trackName, midiOut);
        MoveDisplay.sendText(2, deviceName, midiOut);

        if (this.activeParameter) {
            MoveDisplay.sendText(3, this.activeParameter.name().get(), midiOut);
            MoveDisplay.sendText(4, this.activeParameter.value().displayedValue().get(), midiOut);
        } else {
            MoveDisplay.sendText(3, "", midiOut);
            MoveDisplay.sendText(4, "", midiOut);
        }
        
        MoveDisplay.commit(midiOut);
    },

    /**
     * Handle physical CC input (Called from onMidi0)
     */
    handleCC: function(cc, value, shiftDown) {
        if (value === 0) return false;

        if (cc === MoveHardware.CC.LEFT) {
            if (shiftDown) this.cursorDevice.selectPrevious();
            else this.trackBank.scrollBackwards();
            return true;
        } else if (cc === MoveHardware.CC.RIGHT) {
            if (shiftDown) this.cursorDevice.selectNext();
            else this.trackBank.scrollForwards();
            return true;
        } else if (cc === MoveHardware.CC.UP) {
            this.trackBank.sceneBank().scrollBackwards();
            return true;
        } else if (cc === MoveHardware.CC.DOWN) {
            this.trackBank.sceneBank().scrollForwards();
            return true;
        } else if (cc === MoveHardware.CC.MASTER) {
            var delta = MoveHardware.decodeDelta(value);
            this.cursorTrack.volume().inc(delta, 128);
            return true;
        }

        // Knobs (Parameter Control)
        if (cc >= MoveHardware.CC.KNOB_FIRST && cc <= MoveHardware.CC.KNOB_LAST) {
            var knobIdx = cc - MoveHardware.CC.KNOB_FIRST;
            var rc = this.remoteControls.getParameter(knobIdx);
            var delta = MoveHardware.decodeDelta(value);
            if (delta !== 0) {
                rc.inc(delta, 128);
                // Real-time feedback
                this.activeParameter = rc;
                this.updateDisplay(midiOut);
            }
            return true;
        }

        return false;
    },

    /**
     * Handle Knob touches (Note 0-9)
     */
    handleTouch: function(status, note, velocity) {
        if (note >= 0 && note <= 9) {
            var isPress = ((status & 0xF0) === 0x90 && velocity > 0);
            
            if (isPress) {
                if (note >= 0 && note <= 7) {
                    this.activeParameter = this.remoteControls.getParameter(note);
                } else if (note === 8) {
                    this.activeParameter = this.cursorTrack.volume();
                }
                
                // Trigger immediate update when touched
                if (typeof midiOut !== 'undefined') {
                    this.updateDisplay(midiOut);
                }
            }
            // Note: We don't clear activeParameter on release ("it should stay")
            return true;
        }
        return false;
    }
};
