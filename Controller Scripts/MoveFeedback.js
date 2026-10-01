/** Host feedback follows deliberate controller actions, never observer refreshes. */
var MoveFeedback = {
    follow: true,
    notifications: true,
    lastMessage: "",
    lastTime: 0,
    indicationLayer: null,
    init: function (host) {
        var self = this;
        var prefs = host.getPreferences();
        prefs.getEnumSetting("Follow controller", "Bitwig UI", ["On", "Off"], "On")
            .addValueObserver(function (value) { self.follow = value === "On"; });
        prefs.getEnumSetting("Status notifications", "Bitwig UI", ["On", "Off"], "On")
            .addValueObserver(function (value) { self.notifications = value === "On"; });
    },
    notify: function (text) {
        var now = Date.now();
        if (!this.notifications || (text === this.lastMessage && now - this.lastTime < 1500)
            || now - this.lastTime < 250) return;
        host.showPopupNotification(text);
        this.lastMessage = text;
        this.lastTime = now;
    },
    showClip: function () {
        if (this.follow && MoveSequencer.hasClip()) MoveNotes.cursorClip.showInEditor();
    },
    selectStep: function (x) {
        if (!this.follow) return;
        this.showClip();
        var first = true;
        for (var y = 0; y < 128; y++) {
            if (MoveNotes.stepHas[x + "_" + y]) {
                MoveNotes.cursorClip.selectStepContents(x, y, first);
                first = false;
            }
        }
    },
    updateIndications: function () {
        var layer = ui.mode !== "mixer" ? "remote"
            : modifiers.copy ? (modifiers.shift ? "sendB" : "sendA")
            : modifiers.mute ? "pan" : "volume";
        if (layer === this.indicationLayer) return;
        this.indicationLayer = layer;
        for (var i = 0; i < 8; i++) {
            MoveNavigation.remoteControls.getParameter(i).setIndication(layer === "remote");
            var track = MoveNavigation.channelAt(i);
            track.volume().setIndication(layer === "volume");
            track.pan().setIndication(layer === "pan");
            if (i < 7) {
                track.sendBank().getItemAt(0).setIndication(layer === "sendA");
                track.sendBank().getItemAt(1).setIndication(layer === "sendB");
            }
        }
    }
};
