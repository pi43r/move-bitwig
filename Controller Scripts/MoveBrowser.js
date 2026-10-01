/**
 * MoveBrowser.js
 * Bitwig popup-browser control: add / replace devices from the hardware.
 *
 * Capture+Click / Shift+Click: presets of the focused device (replace it);
 * Capture+Shift+Click: add a device after it.
 * While open (takes over wheel/arrows, everything else falls through):
 *        Wheel      browse results        Jog Click   load selection
 *        Up/Down    jump 8 results        Back        cancel
 * Filters (category, device, ...) are left to the mouse; Left/Right do nothing.
 */

var MoveBrowser = {
    browser: null,
    cursorTrack: null,
    cursorDevice: null,
    resultsItem: null,
    presetDevice: null,
    deviceFilters: null,
    browseRequest: 0,
    filterRequest: 0,
    BANK_SIZE: 128,
    newTrackBank: null,

    init: function (host, cursorTrack, cursorDevice) {
        this.cursorTrack = cursorTrack;
        this.cursorDevice = cursorDevice;
        // Track creation appends to the main-track list, before returns and Main.
        this.newTrackBank = host.createMainTrackBank(1, 0, 0);
        this.newTrackBank.itemCount().markInterested();
        this.newTrackBank.scrollPosition().markInterested();
        this.newTrackBank.getItemAt(0).exists().markInterested();
        this.newTrackBank.getItemAt(0).position().markInterested();

        this.browser = host.createPopupBrowser();
        this.browser.exists().markInterested();
        this.browser.title().markInterested();
        this.browser.contentTypeNames().markInterested();
        this.deviceFilters = this.browser.deviceColumn().createItemBank(this.BANK_SIZE);
        for (var i = 0; i < this.BANK_SIZE; i++) {
            this.deviceFilters.getItemAt(i).name().markInterested();
            this.deviceFilters.getItemAt(i).exists().markInterested();
        }
        this.browser.selectedContentTypeName().markInterested();
        this.browser.selectedContentTypeIndex().markInterested();
        this.resultsItem = this.browser.resultsColumn().createCursorItem();
        this.resultsItem.name().markInterested();
        this.resultsItem.exists().markInterested();

        // Repaint (display takeover) whenever the browser opens/closes
        var self = this;
        this.browser.exists().addValueObserver(function (open) {
            var request = ++self.filterRequest;
            if (open && self.presetDevice !== null) {
                var name = self.presetDevice;
                self.presetDevice = null;
                host.scheduleTask(function () {
                    if (request === self.filterRequest) self.selectPresets(name);
                }, 100);
            }
            host.requestFlush();
        });
    },

    isOpen: function () {
        return this.browser.exists().get();
    },

    /** Switch to the first content type matching `pattern`; false if there is none. */
    selectContentType: function (pattern) {
        var types = this.browser.contentTypeNames().get();
        for (var i = 0; i < types.length; i++) {
            if (pattern.test(types[i])) {
                this.browser.selectedContentTypeIndex().set(i);
                return true;
            }
        }
        return false;
    },

    /** Presets tab filtered to device `name`; all presets when it has none. */
    selectPresets: function (name) {
        if (!this.isOpen() || !this.selectContentType(/preset/i)) return;
        var self = this;
        var request = this.filterRequest;
        var wildcard = this.browser.deviceColumn().getWildcardItem();
        // Filter columns and results refresh asynchronously after each change.
        host.scheduleTask(function () {
            if (!self.isOpen() || request !== self.filterRequest) return;
            var found = false;
            for (var j = 0; j < self.BANK_SIZE && !found; j++) {
                var item = self.deviceFilters.getItemAt(j);
                if (item.exists().get() && item.name().get() === name) {
                    item.isSelected().set(true);
                    found = true;
                }
            }
            if (!found) wildcard.isSelected().set(true);
            host.scheduleTask(function () {
                if (!self.isOpen() || request !== self.filterRequest) return;
                if (found && !self.resultsItem.exists().get()) {
                    wildcard.isSelected().set(true);
                    MoveNavigation.toast("No " + name + " presets");
                } else MoveNavigation.toast(found ? name + " presets" : "All presets");
            }, 150);
        }, 100);
    },

    /** Once `track` is selected, open the instrument browser if it has no instrument. */
    browseIfEmpty: function (track) {
        var position = track.position().get();
        var self = this;
        var request = ++this.browseRequest;
        host.scheduleTask(function () {
            if (request !== self.browseRequest || self.cursorTrack.position().get() !== position) return;
            if (!MoveNavigation.instrumentDevice.exists().get()) self.replaceInstrument();
        }, 200);
    },

    newInstrumentTrack: function () { this.newTrack(true); },
    newAudioTrack: function () { this.newTrack(false); },

    newTrack: function (instrument) {
        if (this.creatingTrack) return;
        this.creatingTrack = true;
        var self = this;
        var index = this.newTrackBank.itemCount().get();
        var request = ++this.browseRequest;
        var attempts = 0, selected = false;
        MoveNotes.cancelPendingNotes();
        MoveNotes.cancelStepGesture();
        if (instrument) MoveTransport.application.createInstrumentTrack(-1);
        else MoveTransport.application.createAudioTrack(-1);
        MoveNavigation.toast(instrument ? "New instrument track" : "New audio track");
        var finish = function () {
            if (request !== self.browseRequest) { self.creatingTrack = false; return; }
            var count = self.newTrackBank.itemCount().get();
            var track = self.newTrackBank.getItemAt(0);
            if (count === index + 1) {
                if (self.newTrackBank.scrollPosition().get() !== index) {
                    self.newTrackBank.scrollPosition().set(index);
                } else if (track.exists().get()) {
                    if (!selected) { track.selectInEditor(); selected = true; }
                    else if (self.cursorTrack.exists().get()
                        && self.cursorTrack.position().get() === track.position().get()
                        && self.cursorTrack.canHoldNoteData().get() === instrument) {
                        self.creatingTrack = false;
                        setMode(instrument ? "note" : "session");
                        if (instrument) self.replaceInstrument();
                        return;
                    }
                }
            }
            if (count > index + 1 || ++attempts >= 15) {
                self.creatingTrack = false;
                MoveNavigation.toast(instrument ? "Select the new track; Capture+click" : "Select the new audio track");
            } else host.scheduleTask(finish, 100);
        };
        host.scheduleTask(finish, 100);
    },

    replaceInstrument: function () {
        if (!this.cursorTrack.exists().get()) { this.newInstrumentTrack(); return; }
        var instrument = MoveNavigation.instrumentDevice;
        if (instrument.exists().get()) {
            this.presetDevice = instrument.name().get();
            instrument.replaceDeviceInsertionPoint().browse();
        } else this.cursorTrack.startOfDeviceChainInsertionPoint().browse();
    },

    /** Browse the focused device's presets to replace it (empty chain: add an instrument). */
    replaceDevice: function () {
        if (this.cursorDevice.exists().get()) {
            this.presetDevice = this.cursorDevice.name().get();
            this.cursorDevice.replaceDeviceInsertionPoint().browse();
        } else {
            this.replaceInstrument();
        }
    },

    /** Capture+Shift+Click: insert after the selected device. */
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
        // Explicit browsing takes ownership from delayed preset initialization.
        if (cc === MoveHardware.CC.JOG_WHEEL || cc === MoveHardware.CC.JOG_CLICK
            || cc === MoveHardware.CC.UP || cc === MoveHardware.CC.DOWN || cc === MoveHardware.CC.BACK)
            this.filterRequest++;

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
        // Left/Right do nothing while browsing (otherwise they would scroll tracks).
        if (cc === MoveHardware.CC.LEFT || cc === MoveHardware.CC.RIGHT) return true;
        if (cc === MoveHardware.CC.UP || cc === MoveHardware.CC.DOWN) {
            for (var n = 0; n < 8; n++) {
                if (cc === MoveHardware.CC.UP) this.browser.selectPreviousFile();
                else this.browser.selectNextFile();
            }
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
        MoveScreen.frame("BROWSE", this.resultsItem.name().get() || "No results",
            this.browser.selectedContentTypeName().get(), "Click=load Up/Dn=x8");
    }
};
