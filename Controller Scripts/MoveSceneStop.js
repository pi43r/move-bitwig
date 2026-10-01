/** Scene-specific stop across the project, without moving the performance bank. */
var MoveSceneStop = {
    bank: null,
    width: 64,
    request: 0,

    init: function (host) {
        // A flat list includes children of collapsed groups. Page through it rather
        // than imposing a fixed project-track limit or subscribing to every scene.
        this.bank = host.createTrackBank(this.width, 0, 1, true);
        this.bank.setShouldShowClipLauncherFeedback(false);
        this.bank.itemCount().markInterested();
        this.bank.scrollPosition().markInterested();
        this.bank.sceneBank().scrollPosition().markInterested();
        this.bank.sceneBank().getItemAt(0).sceneIndex().markInterested();
        for (var i = 0; i < this.width; i++) {
            var track = this.bank.getItemAt(i);
            track.exists().markInterested();
            track.isGroup().markInterested();
            track.trackType().markInterested();
            var slots = track.clipLauncherSlotBank();
            slots.isMasterTrackContentShownOnTrackGroups().markInterested();
            var slot = slots.getItemAt(0);
            slot.sceneIndex().markInterested();
            slot.hasContent().markInterested();
            slot.isPlaying().markInterested();
            slot.isRecording().markInterested();
            slot.isPlaybackQueued().markInterested();
            slot.isRecordingQueued().markInterested();
        }
    },

    cancel: function () { this.request++; },

    stop: function (scene) {
        if (scene < 0) return;
        var request = ++this.request;
        this.bank.sceneBank().scrollPosition().set(scene);
        MoveNavigation.toast("Stopping scene " + (scene + 1));
        this.scan(request, scene, 0);
    },

    scan: function (request, scene, first) {
        if (request !== this.request) return;
        this.bank.scrollPosition().set(first);
        var self = this;
        // Bitwig refreshes bank proxies asynchronously after a scroll. Read on a
        // subsequent host task, not in the same MIDI callback as the move.
        var attempts = 0;
        var read = function () {
            if (request !== self.request) return;
            var count = self.bank.itemCount().get();
            var start = self.bank.scrollPosition().get();
            var end = Math.min(count, start + self.width);
            if (count === 0 || first >= count) return;
            var sceneReady = self.bank.sceneBank().getItemAt(0).sceneIndex().get() === scene;
            // The last page may be clamped backwards, overlapping the prior page.
            if (!sceneReady || start > first || end <= first) {
                if (++attempts < 10) host.scheduleTask(read, 100);
                else MoveNavigation.toast("Scene stop interrupted; try again");
                return;
            }
            for (var i = Math.max(0, first - start); i < end - start; i++) {
                var track = self.bank.getItemAt(i);
                if (!track.exists().get() || track.trackType().get() === "Master") continue;
                var slots = track.clipLauncherSlotBank();
                // A group's scene launch button aggregates its children: stopping
                // the group would also stop children playing different scenes.
                // Actual clips on the group master are handled when exposed.
                if (track.isGroup().get() && !slots.isMasterTrackContentShownOnTrackGroups().get()) continue;
                var slot = slots.getItemAt(0);
                if (slot.sceneIndex().get() !== scene || !slot.hasContent().get()) continue;
                if (slot.isPlaying().get() || slot.isRecording().get()
                    || slot.isPlaybackQueued().get() || slot.isRecordingQueued().get()) slots.stop();
            }
            if (end < count) self.scan(request, scene, end);
            else MoveNavigation.toast("Stop scene " + (scene + 1));
        };
        host.scheduleTask(read, 120);
    }
};
