/**
 * Session: pad columns 1-7 = the track window (left to right, scenes top to
 * bottom), column 8 = scene launchers (red while Shift is held: Shift+launcher
 * stops that scene). The window spans all tracks, so scrolling right past the
 * last instrument/audio track shows the FX returns.
 *
 * Step buttons:
 *   1,3,..,13   select track 1-7 (shows its device chain)
 *   2,4,..,14   stop track 1-7
 *   15          select Main
 *   16          stop all clips
 */
var MoveGrid = {
    TRACKS: 7,
    SCENES: 4,
    trackBank: null,
    copySource: null,
    heldTrack: -1,
    allScenes: null,

    init: function (host, trackBank) {
        this.trackBank = trackBank;
        this.allScenes = host.createSceneBank(1);
        MoveSceneStop.init(host);
        trackBank.setShouldShowClipLauncherFeedback(true);
        for (var t = 0; t < this.TRACKS; t++) {
            var slots = trackBank.getItemAt(t).clipLauncherSlotBank();
            for (var s = 0; s < this.SCENES; s++) {
                var slot = slots.getItemAt(s);
                slot.hasContent().markInterested();
                slot.isPlaying().markInterested();
                slot.isRecording().markInterested();
                slot.isPlaybackQueued().markInterested();
                slot.isRecordingQueued().markInterested();
                slot.color().markInterested();
                slot.sceneIndex().markInterested();
            }
        }
        for (s = 0; s < this.SCENES; s++) trackBank.sceneBank().getItemAt(s).exists().markInterested();
    },

    slotAt: function (track, scene) {
        return this.trackBank.getItemAt(track).clipLauncherSlotBank().getItemAt(scene);
    },

    /** Main has no clips of its own; its column stays dark. */
    isMain: function (track) {
        return track.trackType().get() === "Master";
    },

    slotColor: function (track, slot, blinkPhase) {
        var C = MoveHardware.COLOR;
        if (!track.exists().get() || this.isMain(track)) return C.BLACK;
        var queued = slot.isPlaybackQueued().get() || slot.isRecordingQueued().get();
        if (slot.isRecordingQueued().get()) return blinkPhase ? C.RECORDING : C.DIM_RED;
        if (slot.isRecording().get()) return C.RECORDING;
        if (slot.hasContent().get()) {
            var c = slot.color();
            return (slot.isPlaying().get() || queued) && blinkPhase ? C.WHITE
                : MoveHardware.nearestColor(c.red() * 0.4, c.green() * 0.4, c.blue() * 0.4);
        }
        // Empty slots retain a faint track identity; unassigned columns stay dark.
        var color = track.color();
        var r = color.red(), g = color.green(), b = color.blue();
        var peak = Math.max(r, g, b);
        var level = peak > 0 ? 0.1 / peak : 0;
        return MoveHardware.nearestColor(r * level, g * level, b * level)
            || MoveHardware.nearestColor(0.1, 0.1, 0.1);
    },

    updateLEDs: function (blinkPhase) {
        var C = MoveHardware.COLOR;
        for (var s = 0; s < this.SCENES; s++) {
            var queuedScene = false;
            for (var t = 0; t < this.TRACKS; t++) {
                var slot = this.slotAt(t, s);
                queuedScene = queuedScene || slot.isPlaybackQueued().get() || slot.isRecordingQueued().get();
                MoveProtocol.ledNote(MoveHardware.getPadNote(t, s),
                    this.slotColor(this.trackBank.getItemAt(t), slot, blinkPhase));
            }
            var color = C.BLACK;
            if (this.trackBank.sceneBank().getItemAt(s).exists().get()) {
                color = modifiers.shift ? C.RED : queuedScene && blinkPhase ? C.WHITE : C.GREEN;
            }
            MoveProtocol.ledNote(MoveHardware.getPadNote(7, s), color);
        }
        this.updateStepLEDs();
    },

    updateStepLEDs: function () {
        var C = MoveHardware.COLOR;
        for (var i = 0; i < 16; i++) {
            var track = MoveNavigation.channelAt(Math.floor(i / 2));
            var color = C.BLACK;
            if (i === 15) color = C.DIM_RED;
            else if (track.exists().get() && (i === 14 || !this.isMain(track))) {
                if (i % 2) color = C.DIM_RED;
                else if (MoveNavigation.trackSelected[i / 2]) color = C.WHITE;
                else {
                    var c = track.color();
                    color = MoveHardware.nearestColor(c.red() * 0.3, c.green() * 0.3, c.blue() * 0.3) || C.HAS_CLIP;
                }
            }
            MoveProtocol.ledNote(MoveHardware.NOTES.STEP_FIRST + i, color);
        }
    },

    launchScene: function (index, stop) {
        var scene = this.trackBank.sceneBank().scrollPosition().get() + index;
        if (stop) {
            MoveSceneStop.stop(scene);
            return;
        }
        MoveSceneStop.cancel();
        this.trackBank.sceneBank().getItemAt(index).launch();
        MoveNavigation.toast("Launch scene " + (scene + 1));
    },

    handlePad: function (cell, modifiers) {
        if (cell.col === 7) { this.launchScene(cell.row, modifiers.shift); return; }
        var track = this.trackBank.getItemAt(cell.col);
        if (!track.exists().get()) return;
        if (this.isMain(track)) return;
        var slot = this.slotAt(cell.col, cell.row);
        if (modifiers.copy) {
            if (this.copySource === null) {
                if (!slot.hasContent().get()) return;
                this.copySource = { track: cell.col, scene: cell.row };
                MoveNavigation.toast("Copy: choose target pad");
            } else {
                slot.replaceInsertionPoint().copySlotsOrScenes(this.slotAt(this.copySource.track, this.copySource.scene));
                this.copySource = null;
                MoveNavigation.toast("Clip copied");
            }
            return;
        }
        if (modifiers.del) { slot.deleteObject(); MoveNavigation.toast("Clip deleted"); return; }

        MoveSceneStop.cancel();
        MoveNavigation.selectTrack(track);
        slot.select();
        if (modifiers.shift) { MoveNavigation.toast("Clip selected"); return; }
        if (slot.hasContent().get()) {
            if (MoveFeedback.follow) slot.showInEditor();
            slot.launch();
            MoveNavigation.toast("Clip launched");
        } else if (!track.arm().get()) {
            // Empty slot on an unarmed track acts as the track's stop button.
            track.stop();
            MoveNavigation.toast("Stop: " + track.name().get());
        } else if (track.canHoldNoteData().get()) {
            // Armed instrument: new clip for the sequencer; empty tracks browse first.
            track.createNewLauncherClip(slot.sceneIndex().get());
            MoveBrowser.browseIfEmpty(track);
            setMode("note");
        } else {
            slot.record();
            MoveNavigation.toast("Recording audio clip");
        }
    },

    handleStep: function (i, modifiers) {
        if (i === 15) { MoveSceneStop.cancel(); this.allScenes.stop(); MoveNavigation.toast("Stop all clips"); return; }
        var track = MoveNavigation.channelAt(Math.floor(i / 2));
        if (!track.exists().get() || (i < 14 && this.isMain(track))) return;
        if (i % 2 === 0) {
            if (modifiers.del) track.deleteObject();
            else if (modifiers.copy) track.duplicate();
            else if (modifiers.mute) { track.mute().toggle(); modifiers.muteUsed = true; }
            else { this.heldTrack = i / 2; MoveNavigation.selectTrack(track, true); }
        } else {
            track.stop();
            MoveNavigation.toast("Stop: " + track.name().get());
        }
    },

    handleNote: function (status, note, velocity, modifiers) {
        var pressed = (status & 0xF0) === 0x90 && velocity > 0;
        if (note >= MoveHardware.NOTES.PAD_FIRST && note <= MoveHardware.NOTES.PAD_LAST) {
            if (pressed) this.handlePad(MoveHardware.getPadCoordinate(note), modifiers);
            return true;
        }
        if (note >= MoveHardware.NOTES.STEP_FIRST && note <= MoveHardware.NOTES.STEP_LAST) {
            var i = note - MoveHardware.NOTES.STEP_FIRST;
            if (pressed) this.handleStep(i, modifiers);
            else if (i % 2 === 0 && this.heldTrack === i / 2) this.heldTrack = -1;
            return true;
        }
        return false;
    }
};
