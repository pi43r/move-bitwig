/**
 * MoveGrid.js
 * SESSION mode: pads = 8x4 clip launcher, step buttons = track select/stop.
 * Also: Session Overview sub-mode (Shift+Menu) — each pad jumps the 8x4
 * window to a block of tracks/scenes.
 *
 * Pad LEDs use note-on + palette velocity (LED_NOTE), the same mechanism
 * Move's own firmware uses for pads (the RGB sysex index space is CC-only).
 *
 * Step buttons (manual parity):
 *   odd steps (1,3,..,15)  select track 1-8
 *   even steps (2,4,..,14) stop the playing clip in track 1-7
 *   step 16                stop all clips
 */

var MoveGrid = {
    trackBank: null,
    copySource: null, // {track, scene} pending Copy+Pad source

    init: function (host, trackBank) {
        this.trackBank = trackBank;
        this.trackBank.setShouldShowClipLauncherFeedback(true);

        for (var t = 0; t < 8; t++) {
            var track = this.trackBank.getItemAt(t);
            var clipLauncher = track.clipLauncherSlotBank();
            for (var s = 0; s < 4; s++) {
                var slot = clipLauncher.getItemAt(s);
                slot.hasContent().markInterested();
                slot.isPlaying().markInterested();
                slot.isRecording().markInterested();
                slot.isPlaybackQueued().markInterested();
                slot.isRecordingQueued().markInterested();
                slot.color().markInterested();
            }
        }
    },

    /**
     * Pad + step LEDs for SESSION mode (called from flush).
     * blinkPhase toggles ~3x/sec for queued-clip blinking.
     */
    updateLEDs: function (blinkPhase, overview) {
        if (overview) this.updateOverviewPadLEDs();
        else this.updatePadLEDs(blinkPhase);
        this.updateStepLEDs();
    },

    updatePadLEDs: function (blinkPhase) {
        for (var t = 0; t < 8; t++) {
            var track = this.trackBank.getItemAt(t);
            var clipLauncher = track.clipLauncherSlotBank();

            for (var s = 0; s < 4; s++) {
                var slot = clipLauncher.getItemAt(s);
                var note = MoveHardware.getPadNote(t, s);
                var color = MoveHardware.COLOR.BLACK;

                if (slot.isRecordingQueued().get()) {
                    color = blinkPhase ? MoveHardware.COLOR.RECORDING : MoveHardware.COLOR.DIM_RED;
                } else if (slot.hasContent().get()) {
                    if (slot.isRecording().get()) {
                        color = MoveHardware.COLOR.RECORDING;
                    } else {
                        var c = slot.color();
                        var queued = slot.isPlaybackQueued().get();
                        var bright = slot.isPlaying().get() || (queued && blinkPhase);
                        var dim = bright ? 1.0 : 0.25;
                        color = MoveHardware.nearestColor(
                            c.red() * dim, c.green() * dim, c.blue() * dim);
                    }
                }

                MoveProtocol.ledNote(note, color);
            }
        }
    },

    /**
     * Session Overview: pad column c = tracks c*8.., pad row r = scenes r*4..
     * White = block containing the current window, dim = block within the
     * project bounds, off = outside.
     */
    updateOverviewPadLEDs: function () {
        var trackCount = this.trackBank.itemCount().get();
        var sceneCount = this.trackBank.sceneBank().itemCount().get();
        var curT = Math.floor(this.trackBank.scrollPosition().get() / 8);
        var curS = Math.floor(this.trackBank.sceneBank().scrollPosition().get() / 4);

        for (var c = 0; c < 8; c++) {
            for (var r = 0; r < 4; r++) {
                var note = MoveHardware.getPadNote(c, r);
                var color = MoveHardware.COLOR.BLACK;
                if (c === curT && r === curS) color = MoveHardware.COLOR.WHITE;
                else if (c * 8 < trackCount && r * 4 < sceneCount) color = MoveHardware.COLOR.HAS_CLIP;
                MoveProtocol.ledNote(note, color);
            }
        }
    },

    updateStepLEDs: function () {
        for (var i = 0; i < 16; i++) {
            var stepNote = MoveHardware.NOTES.STEP_FIRST + i;
            var color = MoveHardware.COLOR.BLACK;
            var t, track;

            if (i === 15) {
                color = MoveHardware.COLOR.DIM_RED; // stop all
            } else if (i % 2 === 0) { // odd-numbered button = select track i/2
                t = i / 2;
                track = this.trackBank.getItemAt(t);
                if (track.exists().get()) {
                    if (MoveNavigation.trackSelected[t]) {
                        color = MoveHardware.COLOR.WHITE;
                    } else {
                        var tc = track.color();
                        color = MoveHardware.nearestColor(
                            tc.red() * 0.3, tc.green() * 0.3, tc.blue() * 0.3);
                    }
                }
            } else { // even-numbered button = stop track (i-1)/2
                t = (i - 1) / 2;
                if (this.trackBank.getItemAt(t).exists().get()) {
                    color = MoveHardware.COLOR.HAS_CLIP; // dim white
                }
            }

            MoveProtocol.ledNote(stepNote, color);
        }
    },

    /**
     * Handle physical pad/step input (called from onMidi0 in SESSION mode).
     * Returns true when consumed. `overview` = Session Overview active.
     */
    handleNote: function (status, note, velocity, modifiers, overview) {
        var isNoteOn = (status & 0xF0) === 0x90 && velocity > 0;

        // Pads
        if (note >= MoveHardware.NOTES.PAD_FIRST && note <= MoveHardware.NOTES.PAD_LAST) {
            if (!isNoteOn) return true; // consume pad note-offs

            var cell = MoveHardware.getPadCoordinate(note);
            if (!cell) return true;

            // Overview: jump the window to the pressed block
            if (overview) {
                this.trackBank.scrollPosition().set(cell.track * 8);
                this.trackBank.sceneBank().scrollPosition().set(cell.scene * 4);
                MoveNavigation.toast("Block " + (cell.track + 1) + "/" + (cell.scene + 1));
                return true;
            }

            var track = this.trackBank.getItemAt(cell.track);
            var slot = track.clipLauncherSlotBank().getItemAt(cell.scene);

            if (modifiers.copy) {
                // Copy+Pad, then Pad: copy clip from source to target
                if (this.copySource === null) {
                    this.copySource = { track: cell.track, scene: cell.scene };
                    MoveNavigation.toast("Copy: choose target pad");
                } else {
                    var src = this.trackBank.getItemAt(this.copySource.track)
                        .clipLauncherSlotBank().getItemAt(this.copySource.scene);
                    slot.replaceInsertionPoint().copySlotsOrScenes(src);
                    this.copySource = null;
                    MoveNavigation.toast("Clip copied");
                }
            } else if (modifiers.del) {
                slot.deleteObject();
            } else if (modifiers.shift) {
                slot.select(); // manual parity: Shift+Pad selects the clip
            } else if (!slot.hasContent().get() && track.arm().get()) {
                slot.record(); // empty slot on armed track: record new clip
            } else {
                slot.launch();
            }
            return true;
        }

        // Step buttons: track select / clip stop
        if (note >= MoveHardware.NOTES.STEP_FIRST && note <= MoveHardware.NOTES.STEP_LAST) {
            if (!isNoteOn) return true;

            var i = note - MoveHardware.NOTES.STEP_FIRST;
            if (i === 15) {
                for (var t = 0; t < 8; t++) {
                    this.trackBank.getItemAt(t).stop(); // stop all
                }
            } else if (i % 2 === 0) {
                this.trackBank.getItemAt(i / 2).selectInEditor();
            } else {
                this.trackBank.getItemAt((i - 1) / 2).stop();
            }
            return true;
        }

        return false;
    }
};
