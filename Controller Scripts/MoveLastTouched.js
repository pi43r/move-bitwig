/** Retain a GUI-chosen parameter independently of device and controller focus. */
var MoveLastTouched = {
    mouse: null,
    target: null,
    sameTarget: null,
    pinPending: false,

    init: function (host) {
        // The unlocked proxy reports GUI selection, including becoming unassigned.
        // The locked proxy keeps the actual parameter, not a device-bank slot.
        this.mouse = host.createLastClickedParameter("move-mouse-parameter", "Move mouse selection");
        this.target = host.createLastClickedParameter("move-last-clicked", "Move volume knob");
        this.mouse.isLocked().set(false);
        this.target.isLocked().set(true);
        this.mouse.parameter().exists().markInterested();
        var parameter = this.target.parameter();
        parameter.exists().markInterested();
        parameter.name().markInterested();
        parameter.value().markInterested();
        parameter.value().displayedValue().markInterested();
        // Names/values are not identities: two devices can both have "Cutoff".
        this.sameTarget = this.mouse.parameter().createEqualsValue(parameter);
        this.sameTarget.markInterested();
    },

    sync: function () {
        if (this.pinPending || !this.mouse.parameter().exists().get() || this.sameTarget.get()) return;
        this.pinPending = true;
        // This API retargets an existing lock to the current GUI parameter.
        this.target.smartToggleLock();
        // Keep it pinned even if the equality observer was briefly behind.
        this.target.isLocked().set(true);
        var self = this;
        host.scheduleTask(function () {
            self.pinPending = false;
            host.requestFlush();
        }, 100);
    },

    parameter: function () {
        var parameter = this.target.parameter();
        return parameter.exists().get() ? parameter : null;
    }
};
