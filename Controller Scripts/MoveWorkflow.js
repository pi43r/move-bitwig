/** Workflow settings, Shift shortcuts, and their icon LEDs. */
var MoveWorkflow = {
    screen: null,
    row: 0,
    /** Shift + Step shortcuts; stepIdx is zero-based. */
    handleShiftStep: function (stepIdx) {
        switch (stepIdx) {
            case 0: // Step 1: new instrument
                MoveBrowser.newInstrumentTrack();
                break;
            case 1: // Step 2: new audio track
                MoveBrowser.newAudioTrack();
                break;
            case 2: // Step 3: Workflow settings
                MoveWorkflow.open("workflow");
                break;
            case 4: // Step 5: Tempo
                MoveWorkflow.open("tempo");
                break;
            case 5: // Step 6: metronome
                MoveTransport.transport.isMetronomeEnabled().toggle();
                MoveNavigation.toast("Metronome");
                break;
            case 6: // Step 7: global groove
                var grooveOn = MoveTransport.toggleGroove();
                MoveNavigation.toast("Groove " + (grooveOn ? "ON" : "OFF"));
                break;
            case 8: // Step 9: Key & Scale overlay (NOTE mode)
                if (ui.mode !== "note") {
                    MoveNavigation.toast("Scale: NOTE mode only");
                } else {
                    MoveNotes.overlayActive = !MoveNotes.overlayActive;
                    host.requestFlush();
                }
                break;
            case 9: // Step 10: full velocity
                var on = MoveNotes.toggleFullVelocity();
                MoveNavigation.toast("Full velocity " + (on ? "ON" : "OFF"));
                break;
            case 14: // Step 15: double clip content
                if (MoveSequencer.hasClip()) {
                    MoveNotes.cursorClip.duplicateContent();
                    MoveNavigation.toast("Content doubled");
                } else {
                    MoveNavigation.toast("No clip selected");
                }
                break;
            case 15: // Step 16: quantize clip
                if (MoveSequencer.hasClip()) {
                    MoveNotes.cursorClip.quantize(quantizeAmount);
                    MoveNavigation.toast("Quantized " + Math.round(quantizeAmount * 100) + "%");
                } else {
                    MoveNavigation.toast("No clip selected");
                }
                break;
        }
    },

    /** Icon row below the steps: available shortcuts and active toggles. */
    updateShiftStepLEDs: function () {
        var C = MoveHardware.COLOR;
        var colors = {};
        if (modifiers.shift) {
            colors[0] = C.HAS_CLIP; // new instrument
            colors[1] = C.HAS_CLIP; // new audio track
            colors[2] = C.WHITE;                                       // quantize amount
            colors[4] = C.HAS_CLIP;                                    // tempo screen
            colors[5] = MoveTransport.transport.isMetronomeEnabled().get()
                ? C.GREEN : C.HAS_CLIP;                                // metronome
            colors[6] = (MoveTransport.groove.getEnabled().get() > 0.5)
                ? C.GREEN : C.HAS_CLIP;                                // groove
            if (ui.mode === "note") {
                colors[8] = MoveNotes.overlayActive ? C.GREEN : C.HAS_CLIP; // scale overlay
            }
            colors[9] = MoveNotes.fullVelocity ? C.GREEN : C.HAS_CLIP; // full velocity
            colors[14] = C.HAS_CLIP;                                   // double content
            colors[15] = C.HAS_CLIP;                                   // quantize clip
        }
        for (var i = 0; i < 16; i++) {
            MoveProtocol.ledCC(16 + i,
                colors[i] !== undefined ? colors[i] : C.BLACK);
        }
    },
    open: function (screen) {
        this.screen = this.screen === screen ? null : screen;
        this.row = 0;
        MoveNotes.overlayActive = false;
        MoveNotes.cancelStepGesture();
        host.requestFlush();
    },
    handleCC: function (cc, value, modifiers) {
        if (!this.screen || value === 0) return false;
        if (cc === MoveHardware.CC.BACK || cc === MoveHardware.CC.JOG_CLICK) {
            this.screen = null;
        } else if (cc === MoveHardware.CC.UP || cc === MoveHardware.CC.DOWN) {
            this.row = Math.max(0, Math.min(2, this.row + (cc === MoveHardware.CC.DOWN ? 1 : -1)));
        } else if (cc === MoveHardware.CC.JOG_WHEEL) {
            var delta = MoveHardware.decodeDelta(value);
            if (delta === 0) return true;
            if (this.screen === "tempo") {
                MoveTransport.transport.tempo().incRaw(delta * (modifiers.shift ? 0.1 : 1));
            } else if (this.row === 0) {
                var amounts = [0.5, 0.75, 1];
                var idx = amounts.indexOf(quantizeAmount);
                quantizeAmount = amounts[Math.max(0, Math.min(2, idx + (delta > 0 ? 1 : -1)))];
            } else if (this.row === 1) {
                MoveSequencer.changeResolution(delta > 0 ? 1 : -1);
            } else {
                // Bitwig 6 unifies launcher and arranger automation writing.
                MoveTransport.transport.isArrangerAutomationWriteEnabled().set(delta > 0);
            }
        } else if (cc !== MoveHardware.CC.LEFT && cc !== MoveHardware.CC.RIGHT) {
            return false;
        }
        host.requestFlush();
        return true;
    },
    updateDisplay: function () {
        if (this.screen === "tempo") {
            MoveScreen.frame("TEMPO", MoveTransport.transport.tempo().displayedValue().get() + " BPM",
                "Tempo", "Wheel=BPM Shift=fine");
            return;
        }
        var entries = [
            "Quantize " + Math.round(quantizeAmount * 100) + "%",
            "Grid " + MoveSequencer.labels[MoveSequencer.resolution],
            "Automation " + (MoveTransport.transport.isArrangerAutomationWriteEnabled().get() ? "ON" : "OFF")
        ];
        MoveScreen.frame("WORKFLOW", entries[this.row], "Workflow " + (this.row + 1) + "/3",
            "Up/Dn=item Wheel=set");
    }
};
