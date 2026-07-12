/**
 * MoveNavigation.js
 * Arrow keys, scrolling, device/track navigation, knobs, display content.
 *
 * Wheel = device navigation (manual parity): turn selects prev/next device,
 * click folds/unfolds, Mute+click toggles the device on/off.
 * Shift+Left/Right = remote controls page. Shift+Up/Down = scene page scroll.
 */

var MoveNavigation = {
    trackBank: null,
    cursorTrack: null,
    cursorDevice: null,
    remoteControls: null,
    masterTrack: null,

    activeParameter: null,
    trackSelected: [],      // per bank track: selected in editor (8)
    toastText: null,
    toastUntil: 0,
    touchMask: 0,           // bitmask of touched knobs 1-8 (notes 0-7)

    init: function (host) {
        this.trackBank = host.createMainTrackBank(8, 2, 4);
        this.cursorTrack = host.createCursorTrack(0, 0);
        this.cursorDevice = this.cursorTrack.createCursorDevice();
        this.remoteControls = this.cursorDevice.createCursorRemoteControlsPage(8);
        this.masterTrack = host.createMasterTrack(0);

        // Window position/size (Session Overview needs these)
        this.trackBank.scrollPosition().markInterested();
        this.trackBank.itemCount().markInterested();
        this.trackBank.sceneBank().scrollPosition().markInterested();
        this.trackBank.sceneBank().itemCount().markInterested();

        // Observers for OLED metadata
        this.cursorTrack.name().markInterested();
        this.cursorTrack.volume().name().markInterested();
        this.cursorTrack.volume().value().displayedValue().markInterested();
        this.cursorDevice.name().markInterested();
        this.cursorDevice.isEnabled().markInterested();
        this.cursorDevice.isExpanded().markInterested();
        this.masterTrack.volume().name().markInterested();
        this.masterTrack.volume().value().displayedValue().markInterested();

        // Remote controls: names/values for display, value+exists for knob rings
        for (var i = 0; i < 8; i++) {
            var rc = this.remoteControls.getParameter(i);
            rc.name().markInterested();
            rc.value().markInterested();
            rc.value().displayedValue().markInterested();
            rc.exists().markInterested();
            rc.setIndication(true);
        }
        this.remoteControls.pageNames().markInterested();
        this.remoteControls.selectedPageIndex().markInterested();

        // Per-bank-track observers shared by Grid (steps/pads) and TrackControls
        var self = this;
        this.trackSelected = [];
        for (i = 0; i < 8; i++) {
            (function (idx) {
                var track = self.trackBank.getItemAt(idx);
                track.exists().markInterested();
                track.color().markInterested();
                track.arm().markInterested();
                track.mute().markInterested();
                self.trackSelected[idx] = false;
                track.addIsSelectedInEditorObserver(function (sel) {
                    self.trackSelected[idx] = sel;
                });
            })(i);
        }
    },

    /** Transient message on display line 3 (~1.5 s). */
    toast: function (text) {
        this.toastText = text;
        this.toastUntil = Date.now() + 1500;
        host.requestFlush();
        host.scheduleTask(function () { host.requestFlush(); }, 1600);
    },

    /**
     * Write display content (called from flush)
     */
    updateDisplay: function () {
        var trackName = this.cursorTrack.name().get() || "No Track";
        var deviceName = this.cursorDevice.name().get() || "No Device";

        MoveProtocol.text(1, trackName);
        if (ui.mode === "session" || ui.mode === "mixer") {
            // Window header instead of the device name (F23)
            var tPos = this.trackBank.scrollPosition().get() + 1;
            var sPos = this.trackBank.sceneBank().scrollPosition().get() + 1;
            MoveProtocol.text(2, "Trk " + tPos + "-" + (tPos + 7)
                + "  Scn " + sPos + "-" + (sPos + 3));
        } else {
            MoveProtocol.text(2, deviceName);
        }

        // A touched knob is explicit intent: its name/value beats any toast.
        if (this.touchMask !== 0 && this.activeParameter) {
            MoveProtocol.text(3, this.activeParameter.name().get());
            MoveProtocol.text(4, this.activeParameter.value().displayedValue().get());
            return;
        }

        if (this.toastText !== null && Date.now() < this.toastUntil) {
            MoveProtocol.text(3, this.toastText);
            MoveProtocol.text(4, "");
            return;
        }

        if (this.activeParameter) {
            MoveProtocol.text(3, this.activeParameter.name().get());
            MoveProtocol.text(4, this.activeParameter.value().displayedValue().get());
        } else {
            MoveProtocol.text(3, "");
            MoveProtocol.text(4, "");
        }
    },

    /**
     * Knob ring LEDs (RGB-capable, idx = CC 71-78): brightness follows the
     * mapped parameter's value; off when the slot is empty.
     */
    updateLEDs: function () {
        for (var i = 0; i < 8; i++) {
            var rc = this.remoteControls.getParameter(i);
            var v = 0;
            if (rc.exists().get()) {
                v = 0.08 + 0.55 * rc.value().get();
            }
            MoveProtocol.ledRGB(MoveHardware.CC.KNOB_FIRST + i, v, v, v);
        }
    },

    /**
     * Handle physical CC input (called from onMidi0)
     */
    handleCC: function (cc, value, modifiers) {
        // Relative encoders send a 0 delta only as noise; buttons send 0 on release.
        if (value === 0) return false;

        if (cc === MoveHardware.CC.LEFT) {
            if (modifiers.shift) this.selectRemotePage(-1);
            else this.trackBank.scrollBackwards();
            return true;
        }
        if (cc === MoveHardware.CC.RIGHT) {
            if (modifiers.shift) this.selectRemotePage(1);
            else this.trackBank.scrollForwards();
            return true;
        }
        if (cc === MoveHardware.CC.UP) {
            if (modifiers.shift) this.trackBank.sceneBank().scrollPageBackwards();
            else this.trackBank.sceneBank().scrollBackwards();
            return true;
        }
        if (cc === MoveHardware.CC.DOWN) {
            if (modifiers.shift) this.trackBank.sceneBank().scrollPageForwards();
            else this.trackBank.sceneBank().scrollForwards();
            return true;
        }

        // Master (volume) knob: master volume, or held track's volume (F4).
        if (cc === MoveHardware.CC.MASTER) {
            var delta = MoveHardware.decodeDelta(value);
            var vol;
            var held = MoveTrackControls.heldTrack;
            if (held >= 0) {
                vol = this.trackBank.getItemAt(held).volume();
            } else {
                vol = this.masterTrack.volume();
            }
            vol.inc(delta, modifiers.shift ? 512 : 128);
            this.activeParameter = vol;
            host.requestFlush();
            return true;
        }

        // Jog wheel: device navigation (turn), fold/enable (click).
        // Shift+wheel = tempo (1 BPM per detent).
        if (cc === MoveHardware.CC.JOG_WHEEL) {
            var jogDelta = MoveHardware.decodeDelta(value);
            if (modifiers.shift) {
                MoveTransport.transport.tempo().incRaw(jogDelta);
                this.toast("Tempo " + MoveTransport.transport.tempo().displayedValue().get());
                return true;
            }
            if (jogDelta > 0) this.cursorDevice.selectNext();
            else if (jogDelta < 0) this.cursorDevice.selectPrevious();
            return true;
        }
        if (cc === MoveHardware.CC.JOG_CLICK) {
            if (value !== 127) return true;
            if (modifiers.mute) {
                this.cursorDevice.isEnabled().toggle();
                modifiers.muteUsed = true;
                this.toast("Device on/off");
            } else {
                this.cursorDevice.isExpanded().toggle();
            }
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

    selectRemotePage: function (dir) {
        if (dir > 0) this.remoteControls.selectNextPage(true);
        else this.remoteControls.selectPreviousPage(true);
        // Show the new page name (observer values update before next flush)
        var self = this;
        host.scheduleTask(function () {
            var names = self.remoteControls.pageNames().get();
            var idx = self.remoteControls.selectedPageIndex().get();
            if (names && idx >= 0 && idx < names.length) {
                self.toast("Page: " + names[idx]);
            }
        }, 50);
    },

    /**
     * Handle knob touches (notes 0-9)
     */
    handleTouch: function (status, note, velocity, modifiers, mixerMode) {
        if (note > 9) return false;

        var isPress = ((status & 0xF0) === 0x90 && velocity > 0);
        if (note <= 7) {
            if (isPress) this.touchMask |= (1 << note);
            else this.touchMask &= ~(1 << note);
        }
        if (isPress) {
            if (note <= 7) {
                var param = mixerMode
                    ? this.trackBank.getItemAt(note).volume()
                    : this.remoteControls.getParameter(note);
                if (modifiers.del) {
                    param.reset(); // Delete + knob tap = reset parameter
                    this.toast("Param reset");
                }
                this.activeParameter = param;
            } else if (note === 8) {
                this.activeParameter = this.masterTrack.volume();
            }
        }
        // activeParameter intentionally stays after release ("sticky");
        // flush on release too so the bars overlay hides again.
        host.requestFlush();
        return true;
    },

    /**
     * 8 volume bars on the display's lower half while a knob is touched —
     * MIXER mode only. Device knobs are contextual instead: the touched
     * parameter's name/value on the display (the rings show the rest).
     */
    updateBars: function (mixerMode) {
        if (!mixerMode || this.touchMask === 0) {
            MoveProtocol.bars(null);
            return;
        }
        var values = [];
        for (var i = 0; i < 8; i++) {
            var track = this.trackBank.getItemAt(i);
            values[i] = track.exists().get() ? track.volume().value().get() : 0;
        }
        MoveProtocol.bars(values);
    }
};
