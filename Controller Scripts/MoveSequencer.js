/** Owns the note-grid window. Times are quarter-note beats, never assumed bars. */
var MoveSequencer = {
    clip: null,
    noteTrack: null,
    page: 0,
    width: 16,
    resolutions: [0.5, 0.25, 0.125],
    labels: ["1/8", "1/16", "1/32"],
    resolution: 1,
    resetPending: true,

    init: function (clip) {
        this.clip = clip;
        clip.setStepSize(this.stepSize());
        clip.scrollToKey(0);
        var self = this;
        var reset = function () {
            self.resetPending = true;
            MoveNotes.cancelStepGesture();
            host.requestFlush();
        };
        clip.exists().addValueObserver(reset);
        clip.clipLauncherSlot().sceneIndex().addValueObserver(reset);
        var track = clip.getTrack();
        track.position().addValueObserver(reset);
        this.noteTrack = track.canHoldNoteData();
        this.noteTrack.markInterested();
        clip.getLoopStart().addValueObserver(function () { host.requestFlush(); });
        clip.getLoopLength().addValueObserver(function () { host.requestFlush(); });
    },

    stepSize: function () { return this.resolutions[this.resolution]; },
    pageBeats: function () { return this.width * this.stepSize(); },
    hasClip: function () {
        return this.clip.exists().get() && this.noteTrack.get() && MoveNotes.trackMatches();
    },

    bounds: function () {
        var start = Math.max(0, this.clip.getLoopStart().get());
        var length = Math.max(0, this.clip.getLoopLength().get());
        var end = start + length;
        var first = Math.floor(start / this.pageBeats());
        var last = Math.max(first, Math.ceil(end / this.pageBeats() - 1e-9) - 1);
        return { start: start, end: end, first: first, last: last };
    },

    /** Called before LED/display rendering, after Bitwig's observer updates. */
    sync: function () {
        var b = this.bounds();
        var target = this.resetPending ? b.first : Math.max(b.first, Math.min(b.last, this.page));
        if (target !== this.page || this.resetPending) {
            this.setPage(target);
            this.resetPending = false;
        }
    },

    setPage: function (page) {
        this.page = Math.max(0, page);
        MoveNotes.cancelStepGesture();
        // Same page-aligned usage as DrivenByMoss CursorClipImpl.scrollToPage.
        this.clip.scrollToStep(this.page * this.width);
        host.requestFlush();
    },

    navigate: function (direction) {
        if (!this.hasClip()) { MoveNavigation.toast("Select a note clip"); return; }
        this.sync();
        var b = this.bounds();
        var next = Math.max(b.first, Math.min(b.last, this.page + direction));
        if (next === this.page) {
            MoveNavigation.toast(direction < 0 ? "Start of loop" : "End of loop");
            return;
        }
        this.setPage(next);
        MoveNavigation.toastText = null;
        MoveFeedback.notify(this.positionLabel() + "  " + this.pageLabel());
    },

    changeResolution: function (direction) {
        if (MoveNotes.heldStep >= 0) { MoveNavigation.toast("Release the step first"); return; }
        var next = Math.max(0, Math.min(this.resolutions.length - 1, this.resolution + direction));
        if (next === this.resolution) return;
        var beat = this.page * this.pageBeats();
        this.resolution = next;
        this.clip.setStepSize(this.stepSize());
        var b = this.bounds();
        this.setPage(Math.max(b.first, Math.min(b.last, Math.floor(beat / this.pageBeats()))));
    },

    canEdit: function (step) {
        if (!this.hasClip() || this.resetPending || step < 0 || step >= this.width) return false;
        var b = this.bounds();
        var beat = (this.page * this.width + step) * this.stepSize();
        return beat >= b.start - 1e-9 && beat < b.end - 1e-9;
    },

    /** Playhead as a step on the visible page, or -1. (playingStep counts from the clip start.) */
    playingIndex: function () {
        var step = this.clip.playingStep().get();
        if (step < 0) return -1;
        var index = step - this.page * this.width;
        return index >= 0 && index < this.width ? index : -1;
    },

    /**
     * Bar overview for the screen (4/4 bars, clamped to 64):
     * [bars, loopStart, loopEnd, playingBar + 1 (0 = stopped), pageStart, pageEnd,
     *  progress 1-16 = sixteenths played in the playing bar].
     * Ranges are bar indices, end exclusive.
     */
    overview: function () {
        if (!this.hasClip()) return null;
        var b = this.bounds();
        var clipEnd = Math.max(b.end, this.clip.getPlayStop().get());
        var bars = Math.max(1, Math.min(64, Math.ceil(clipEnd / 4 - 1e-9)));
        function bar(beat, end) {
            var v = end ? Math.ceil(beat / 4 - 1e-9) : Math.floor(beat / 4 + 1e-9);
            return Math.max(0, Math.min(bars, v));
        }
        // playingStep blips to -1 as the loop wraps; hold the last position briefly.
        var step = this.clip.playingStep().get();
        var now = Date.now();
        if (step >= 0) { this.lastStep = step; this.lastStepAt = now; }
        else if (now - (this.lastStepAt || 0) < 250) step = this.lastStep;
        var playing = 0, progress = 0;
        if (step >= 0) {
            var beat = step * this.stepSize();
            playing = Math.min(bars, Math.floor(beat / 4) + 1);
            progress = Math.min(16, Math.floor((beat % 4) * 4) + 1);
        }
        var pageStart = this.page * this.pageBeats();
        return [bars, bar(b.start), Math.max(bar(b.start) + 1, bar(b.end, true)), playing,
            bar(pageStart), Math.max(bar(pageStart) + 1, bar(pageStart + this.pageBeats(), true)), progress];
    },

    formatBeat: function (beat) { return String(Math.round((beat + 1) * 1000) / 1000); },
    positionLabel: function () {
        if (!this.hasClip()) return "Select a note clip";
        var b = this.bounds();
        var start = Math.max(b.start, this.page * this.pageBeats());
        var end = Math.min(b.end, (this.page + 1) * this.pageBeats());
        return "Beat " + this.formatBeat(start) + "-" + this.formatBeat(end);
    },
    pageLabel: function () {
        var b = this.bounds();
        return "Page " + (this.page - b.first + 1) + "/" + (b.last - b.first + 1)
            + "  " + this.labels[this.resolution];
    }
};
