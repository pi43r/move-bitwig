/**
 * MoveNavigation.js
 * Arrow keys, scrolling, device/track navigation, knobs, display content.
 *
 * Wheel = device navigation (manual parity): turn selects prev/next device,
 * click folds/unfolds, Mute+click toggles the device on/off.
 * Left/Right scroll tracks, Up/Down scroll scenes (Shift: a page).
 * Shift+Left/Right = remote controls page.
 *
 * One 7-track window over ALL tracks: scrolling right past the last
 * instrument/audio track brings the FX returns (and Main) into view.
 */

var MoveNavigation = {
    trackBank: null,
    cursorTrack: null,
    cursorDevice: null,
    instrumentDevice: null,
    remoteControls: null,
    masterTrack: null,
    volumeLastTouched: false,
    requestedTrack: null,

    activeParameter: null,
    parameterUntil: 0,
    trackSelected: [],      // per channel (7 window tracks + Main): selected in editor
    toastText: null,
    toastUntil: 0,
    touchMask: 0,           // bitmask of touched knobs 1-8 (notes 0-7)
    touchedAt: 0,           // last knob touch event
    TOUCH_HOLD_MS: 8000,    // a lost touch release cannot pin the screen longer

    init: function (host) {
        // createTrackBank (not createMainTrackBank) includes FX returns and Main.
        this.trackBank = host.createTrackBank(7, 2, 4);
        this.cursorTrack = host.createCursorTrack(0, 64);
        this.cursorTrack.position().markInterested();
        this.cursorTrack.canHoldNoteData().markInterested();
        this.cursorTrack.exists().markInterested();
        this.trackBank.followCursorTrack(this.cursorTrack);
        this.cursorDevice = this.cursorTrack.createCursorDevice();
        // GraalJS won't coerce a string to a Java enum; the follow mode must be the real enum constant.
        var FollowMode = Java.type("com.bitwig.extension.controller.api.CursorDeviceFollowMode");
        this.instrumentDevice = this.cursorTrack.createCursorDevice("move-instrument", "Move instrument", 0, FollowMode.FIRST_INSTRUMENT);
        this.instrumentDevice.exists().markInterested();
        this.instrumentDevice.name().markInterested();
        this.remoteControls = this.cursorDevice.createCursorRemoteControlsPage(8);
        this.masterTrack = host.createMasterTrack(0);
        var navigation = this;
        host.getPreferences().getEnumSetting("Volume knob", "Controls",
            ["Master gain", "Last touched parameter"], "Master gain")
            .addValueObserver(function (value) {
                navigation.volumeLastTouched = String(value) === "Last touched parameter";
                println("Volume knob: " + value);
            });
        MoveLastTouched.init(host);

        // Shared track window follows selection in Bitwig.
        this.trackBank.scrollPosition().markInterested();
        this.trackBank.scrollPosition().addValueObserver(function () {
            MoveGrid.heldTrack = -1;
            MoveTrackControls.heldTrack = -1;
            MoveGrid.copySource = null;
        });
        this.trackBank.itemCount().markInterested();
        this.trackBank.sceneBank().scrollPosition().markInterested();
        this.trackBank.sceneBank().itemCount().markInterested();

        // Observers for OLED metadata
        this.cursorTrack.name().markInterested();
        this.cursorTrack.volume().name().markInterested();
        this.cursorTrack.volume().value().displayedValue().markInterested();
        this.cursorDevice.name().markInterested();
        this.cursorDevice.exists().markInterested();
        this.cursorDevice.isEnabled().markInterested();
        this.cursorDevice.isExpanded().markInterested();
        this.masterTrack.volume().name().markInterested();
        this.masterTrack.volume().value().markInterested();
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
                var track = self.channelAt(idx);
                track.name().markInterested();
                track.position().markInterested();
                track.exists().markInterested();
                track.canHoldNoteData().markInterested();
                track.color().markInterested();
                track.arm().markInterested();
                track.mute().markInterested();
                track.trackType().markInterested();
                self.trackSelected[idx] = false;
                track.addIsSelectedInEditorObserver(function (sel) {
                    self.trackSelected[idx] = sel;
                });
            })(i);
        }
    },

    /** MIXER knob layer: volume, Mute = pan, Copy = send A (Shift: B); Main has no sends. */
    mixerParameter: function (index, modifiers) {
        var track = this.channelAt(index);
        if (!track.exists().get() || (index < 7 && MoveGrid.isMain(track))) return null;
        if (modifiers.copy) return index < 7 ? track.sendBank().getItemAt(modifiers.shift ? 1 : 0) : null;
        return modifiers.mute ? track.pan() : track.volume();
    },

    /** 0-6 = track window, 7 = Main. */
    channelAt: function (index) {
        return index < 7 ? this.trackBank.getItemAt(index) : this.masterTrack;
    },

    /** Select a track; Bitwig then shows its clip, or its device chain when `devices` is set. */
    selectTrack: function (track, devices) {
        if (!track.exists().get()) return;
        this.requestedTrack = track.position().get();
        MoveNotes.cancelPendingNotes();
        MoveNotes.cancelStepGesture();
        MoveBrowser.browseRequest++;
        track.selectInEditor();
        this.toast(track.name().get());
        var self = this;
        host.scheduleTask(function () {
            if (devices) self.showDevices();
            else MoveFeedback.showClip();
        }, 150);
    },

    /** Bring the cursor track's device chain into Bitwig's editor panel. */
    showDevices: function () {
        if (!MoveFeedback.follow) return;
        if (this.cursorDevice.exists().get()) this.cursorDevice.selectInEditor();
        else this.toast("No devices on track");
    },

    volumeParameter: function () {
        var held = MoveTrackControls.heldTrack;
        if (held < 0) held = MoveGrid.heldTrack;
        if (held >= 0) return this.channelAt(held).volume();
        if (!this.volumeLastTouched) return this.masterTrack.volume();
        // Never falls back to Main: Main's volume lives on the Mixer page.
        return MoveLastTouched.parameter();
    },

    handleDeviceCC: function (cc, value, modifiers) {
        if (value === 0) return false;
        if (cc === MoveHardware.CC.JOG_WHEEL || cc === MoveHardware.CC.LEFT || cc === MoveHardware.CC.RIGHT) {
            var dir = cc === MoveHardware.CC.JOG_WHEEL ? MoveHardware.decodeDelta(value)
                : cc === MoveHardware.CC.LEFT ? -1 : 1;
            if (dir > 0) this.cursorDevice.selectNext();
            else if (dir < 0) this.cursorDevice.selectPrevious();
            host.scheduleTask(function () {
                if (MoveFeedback.follow) MoveNavigation.cursorDevice.selectInEditor();
                MoveNavigation.toast(MoveNavigation.cursorDevice.name().get() || "No device");
            }, 80);
            return true;
        }
        if (cc === MoveHardware.CC.JOG_CLICK) {
            if (modifiers.shift) MoveBrowser.addDevice();
            else MoveBrowser.replaceDevice();
            return true;
        }
        return false;
    },

    /** Transient message on display line 3 (~1.5 s). */
    toast: function (text) {
        this.parameterUntil = 0;
        this.toastText = text;
        var duration = Math.min(6500, Math.max(1500, 1700 + (text.length - 20) * 180));
        this.toastUntil = Date.now() + duration;
        MoveFeedback.notify(text);
        host.requestFlush();
        host.scheduleTask(function () { host.requestFlush(); }, duration + 100);
    },

    /** Show `parameter` on screen for a moment. */
    focusParameter: function (parameter) {
        this.activeParameter = parameter;
        this.parameterUntil = Date.now() + 1500;
        this.toastText = null;
        if (!this.parameterFeedbackPending) {
            this.parameterFeedbackPending = true;
            var self = this;
            host.scheduleTask(function () {
                self.parameterFeedbackPending = false;
                var p = self.activeParameter;
                if (p) MoveFeedback.notify(p.name().get() + ": " + p.value().displayedValue().get());
            }, 100);
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

        if (cc === MoveHardware.CC.LEFT || cc === MoveHardware.CC.RIGHT) {
            var right = cc === MoveHardware.CC.RIGHT;
            if (modifiers.shift) this.selectRemotePage(right ? 1 : -1);
            else this.scroll(this.trackBank, right, false);
            return true;
        }
        if (cc === MoveHardware.CC.UP || cc === MoveHardware.CC.DOWN) {
            this.scroll(this.trackBank.sceneBank(), cc === MoveHardware.CC.DOWN, modifiers.shift);
            return true;
        }

        // Master (volume) knob: master volume, or held track's volume (F4).
        if (cc === MoveHardware.CC.MASTER) {
            var delta = MoveHardware.decodeDelta(value);
            var vol = this.volumeParameter();
            if (!vol) { this.toast("Click a parameter in Bitwig"); return true; }
            vol.inc(delta, modifiers.shift ? 512 : 128);
            this.focusParameter(vol);
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
            if (modifiers.del) {
                // Delete + click = delete the current device
                if (this.cursorDevice.exists().get()) {
                    this.cursorDevice.deleteObject();
                    this.toast("Device deleted");
                }
            } else if (modifiers.shift) {
                // Shift + click = browse to replace the current device
                MoveBrowser.replaceDevice();
            } else if (modifiers.mute) {
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
                this.focusParameter(rc);
                host.requestFlush();
            }
            return true;
        }

        return false;
    },

    scroll: function (bank, forwards, page) {
        if (page) { if (forwards) bank.scrollPageForwards(); else bank.scrollPageBackwards(); }
        else if (forwards) bank.scrollForwards();
        else bank.scrollBackwards();
    },

    /** True while a knob is touched (bounded by TOUCH_HOLD_MS) or just after an edit. */
    parameterVisible: function () {
        if (!this.activeParameter) return false;
        if (this.touchMask !== 0 && Date.now() - this.touchedAt > this.TOUCH_HOLD_MS) this.touchMask = 0;
        return this.touchMask !== 0 || Date.now() < this.parameterUntil;
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
                self.toast("Page " + (idx + 1) + ": " + names[idx]);
            }
        }, 50);
    },

    /**
     * Handle knob touches (notes 0-9)
     */
    handleTouch: function (status, note, velocity, modifiers, mixerMode) {
        if (note > 9) return false;

        var isPress = ((status & 0xF0) === 0x90 && velocity > 0);
        // Knob touches hold the parameter screen; the Volume knob's touch does
        // not (Schwung's master-volume handoff can swallow its release).
        if (note <= 7) {
            if (isPress) this.touchMask |= (1 << note);
            else this.touchMask &= ~(1 << note);
            this.touchedAt = Date.now();
        }
        if (isPress) {
            if (note <= 7) {
                var param = mixerMode ? this.mixerParameter(note, modifiers)
                    : this.remoteControls.getParameter(note);
                if (!param) return true;
                if (modifiers.del) {
                    param.reset(); // Delete + knob tap = reset parameter
                    this.toast("Param reset");
                }
                this.focusParameter(param);
            } else if (note === 8) {
                var vol = this.volumeParameter();
                if (vol) this.focusParameter(vol);
            }
        }
        // The parameter remains available, but its screen expires after the edit.
        host.requestFlush();
        return true;
    },

};
