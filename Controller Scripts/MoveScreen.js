/**
 * One screen hierarchy: mode announcement, active edit, held modifier, then
 * the current mode. Line 1 is a "KIND|track" record: the module draws KIND's
 * icon and the selected track's name in the header (see drawDisplay in
 * src/ui.js). The bottom line always says how to use what is on screen.
 * A line holds about 20 characters; keep hints within that.
 */
var MoveScreen = {
    announcement: "",
    announceIcon: "SESSION",
    announceUntil: 0,

    announce: function (name, iconKind) {
        this.announcement = name;
        this.announceIcon = iconKind;
        this.announceUntil = Date.now() + 450;
        MoveNavigation.toastText = null;
        MoveFeedback.notify(name);
        host.scheduleTask(function () { host.requestFlush(); }, 500);
    },

    /** Write one screen. Shift/Capture swap the hint line for their shortcuts. */
    frame: function (kind, primary, secondary, hint) {
        var track = MoveNavigation.cursorTrack.name().get() || "No track";
        MoveProtocol.text(1, kind + "|" + track.replace(/\|/g, "/"));
        MoveProtocol.text(2, primary);
        MoveProtocol.text(3, secondary);
        MoveProtocol.text(4, this.hint(hint));
    },

    hint: function (hint) {
        if (modifiers.device) return modifiers.shift ? "Click: add device" : "Click: presets";
        if (modifiers.shift) return ui.mode === "session" ? "Col 8: stop scene" : "L/R: remote pages";
        return hint;
    },

    update: function () {
        var nav = MoveNavigation;
        var mode = ui.mode;
        var note = mode === "note";
        var toast = nav.toastText && Date.now() < nav.toastUntil ? nav.toastText : "";

        // Shown even with Shift held: Shift + Menu is how Mixer opens.
        if (Date.now() < this.announceUntil) {
            MoveProtocol.text(1, "MODE|" + this.announceIcon);
            MoveProtocol.text(2, this.announcement);
            MoveProtocol.text(3, nav.cursorTrack.name().get() || "");
            MoveProtocol.text(4, "");
            return false;
        }
        if (note && MoveNotes.drumMode && MoveDrumMods.held >= 0) {
            var mod = MoveDrumMods.held;
            this.frame("PARAM", MoveDrumMods.MODS[mod].name + ": " + MoveDrumMods.label(mod),
                MoveNotes.selectedNoteLabel(),
                MoveNotes.heldStep >= 0 ? "Wheel: edit step" : "Wheel=set Step=apply");
            return false;
        }
        // Step edits keep the selected drum/pitch and page visible.
        if (note && MoveNotes.heldStep >= 0) {
            this.frame("STEP", "Step " + (MoveNotes.heldStep + 1) + ": " + MoveNotes.selectedNoteLabel(),
                toast || MoveSequencer.pageLabel(),
                modifiers.shift ? "Wheel: fine length" : "Vol=vel Wheel=length");
            return MoveSequencer.hasClip();
        }
        // Touching a control takes precedence over generic Shift help.
        if (nav.parameterVisible()) {
            var parameter = nav.activeParameter;
            this.frame("PARAM", parameter.name().get() || "Parameter", parameter.value().displayedValue().get(),
                modifiers.shift ? "Fine adjustment" : "Shift=fine Del=reset");
            return false;
        }
        if (modifiers.loop && note) {
            this.frame("LOOP",
                MoveSequencer.hasClip() ? "Length " + MoveNotes.cursorClip.getLoopLength().get() + " beats" : "Select a note clip",
                "Steps: set range", modifiers.shift ? "Wheel: 1/16 steps" : "Wheel: 4 beats");
            return false;
        }
        if (modifiers.del) {
            this.frame("DELETE", mode === "session" ? "Pad: delete clip" : "Track: delete track",
                "Knob touch: reset", "Wheel click: device");
            return false;
        }
        if (modifiers.copy) {
            this.frame("COPY",
                mode === "mixer" ? (modifiers.shift ? "Knobs: Send B" : "Knobs: Send A")
                    : note ? "Track: duplicate" : MoveGrid.copySource ? "Pad: paste clip" : "Pad: choose source",
                mode === "mixer" ? "Shift: Send B" : "Track: duplicate", "Release Copy: exit");
            return false;
        }
        if (modifiers.mute) {
            this.frame("MUTE",
                mode === "mixer" ? "Knobs: pan" : note && MoveNotes.drumMode ? "Pad: mute drum" : "Track: mute track",
                note ? "Step: mute note" : "Click: device on/off",
                modifiers.shift ? "Tap: solo track" : "Tap: mute track");
            return false;
        }
        if (note) {
            // Line 3 = the selected device; the bar overview replaces beat/page text.
            this.frame(MoveNotes.drumMode ? "DRUM" : "NOTE", toast || MoveNotes.selectedNoteLabel(),
                nav.cursorDevice.name().get() || "No device",
                MoveSequencer.hasClip() ? "" : "Tap a step to start");
            return MoveSequencer.hasClip();
        }
        if (mode === "mixer") {
            this.frame("MIX", toast || "Tracks + Main", "Mute=pan Copy=sends", "Rows: arm/solo/mute");
            return false;
        }
        var t = nav.trackBank.scrollPosition().get() + 1;
        var s = nav.trackBank.sceneBank().scrollPosition().get() + 1;
        this.frame("SESSION", toast || nav.cursorDevice.name().get() || "No device",
            "Trk " + t + "-" + (t + MoveGrid.TRACKS - 1) + "  Scn " + s + "-" + (s + MoveGrid.SCENES - 1),
            "Pad: launch clip");
        return false;
    }
};
