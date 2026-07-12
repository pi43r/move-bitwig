/**
 * MoveBrowser.js
 * Bitwig popup-browser control: add / replace devices from the hardware.
 *
 * Open:  Shift+Capture   = add a device after the current one (end of the
 *                          chain when the track has no device yet)
 *        Shift+Jog Click = replace the current device
 * While open (takes over wheel/arrows, everything else falls through):
 *        Wheel      browse results        Jog Click   load selection
 *        Up/Down    content-type tab      Back        cancel
 */

var MoveBrowser = {
    browser: null,
    cursorTrack: null,
    cursorDevice: null,
    resultsItem: null,

    init: function (host, cursorTrack, cursorDevice) {
        this.cursorTrack = cursorTrack;
        this.cursorDevice = cursorDevice;

        this.browser = host.createPopupBrowser();
        this.browser.exists().markInterested();
        this.browser.title().markInterested();
        this.browser.selectedContentTypeName().markInterested();
        this.browser.selectedContentTypeIndex().markInterested();
        this.resultsItem = this.browser.resultsColumn().createCursorItem();
        this.resultsItem.name().markInterested();

        // Repaint (display takeover) whenever the browser opens/closes
        this.browser.exists().addValueObserver(function () {
            host.requestFlush();
        });
    },

    isOpen: function () {
        return this.browser.exists().get();
    },

    /** Shift+Jog Click: browse to replace the current device. */
    replaceDevice: function () {
        if (this.cursorDevice.exists().get()) {
            this.cursorDevice.replaceDeviceInsertionPoint().browse();
        } else {
            this.cursorTrack.endOfDeviceChainInsertionPoint().browse();
        }
    },

    /** Shift+Capture: browse to add a device after the current one. */
    addDevice: function () {
        if (this.cursorDevice.exists().get()) {
            this.cursorDevice.afterDeviceInsertionPoint().browse();
        } else {
            this.cursorTrack.endOfDeviceChainInsertionPoint().browse();
        }
    },

    /**
     * CC handling while the browser is open (checked first in onMidi0).
     * Consumes wheel/click/arrows/Back; everything else falls through.
     */
    handleCC: function (cc, value, modifiers) {
        if (value === 0) return false;

        if (cc === MoveHardware.CC.JOG_WHEEL) {
            var d = MoveHardware.decodeDelta(value);
            while (d > 0) { this.browser.selectNextFile(); d--; }
            while (d < 0) { this.browser.selectPreviousFile(); d++; }
            host.requestFlush();
            return true;
        }
        if (cc === MoveHardware.CC.JOG_CLICK) {
            if (value === 127) {
                var name = this.resultsItem.name().get();
                this.browser.commit();
                MoveNavigation.toast("Loaded: " + name);
            }
            return true;
        }
        if (cc === MoveHardware.CC.UP || cc === MoveHardware.CC.DOWN) {
            var dir = (cc === MoveHardware.CC.UP) ? -1 : 1;
            var idx = this.browser.selectedContentTypeIndex().get() + dir;
            this.browser.selectedContentTypeIndex().set(Math.max(0, idx));
            host.requestFlush();
            return true;
        }
        if (cc === MoveHardware.CC.BACK) {
            this.browser.cancel();
            return true;
        }
        return false;
    },

    /** Display takeover while the browser is open (called from flush). */
    updateDisplay: function () {
        MoveProtocol.text(1, "* " + (this.browser.title().get() || "Browser") + " *");
        MoveProtocol.text(2, "Tab: " + this.browser.selectedContentTypeName().get());
        MoveProtocol.text(3, "> " + this.resultsItem.name().get());
        MoveProtocol.text(4, "Click=load Back=exit");
    }
};
