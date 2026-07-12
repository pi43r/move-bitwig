/**
 * MoveNotes.js
 * NOTE mode: playable pads (instrument / drum sub-modes) + 16-step sequencer.
 *
 * Pads play the cursor track through a NoteInput with a key translation
 * table (pads = notes 68-99 on ch 1). In SESSION mode the table is all -1
 * so pads never sound. The script still sees all events
 * (setShouldConsumeEvents(false)) for LEDs and sequencing.
 */

var MoveNotes = {
    noteInput: null,
    cursorTrack: null,
    cursorDevice: null,
    cursorClip: null,
    drumPadBank: null,

    active: false,          // true while ui.mode === "note"
    drumMode: false,        // auto: cursor device has drum pads
    octave: 4,              // instrument sub-mode octave (C4-based row origin)
    rootKey: 0,             // 0 = C
    scale: [0, 2, 4, 5, 7, 9, 11], // major; scale menu comes later
    drumScrollPos: 36,      // first drum pad note in the bank window

    lastPlayedKey: 60,      // sequencer target key (last pad played)
    stepHas: {},            // "x_y" -> true for note starts in the clip window
    stepCount: [],          // notes per step column (16)
    heldStep: -1,           // step button currently held (-1 = none)
    stepEdited: false,      // knob/wheel touched while a step was held
    fullVelocity: false,    // Shift+Step 10: pads always play at 127

    init: function (host, midiIn, cursorTrack, cursorDevice) {
        this.cursorTrack = cursorTrack;
        this.cursorDevice = cursorDevice;

        // NoteInput: pads sound only when the translation table says so.
        this.noteInput = midiIn.createNoteInput("Move Pads", "90????", "80????");
        this.noteInput.setShouldConsumeEvents(false);

        // Drum sub-mode detection + 32-pad window
        var self = this;
        this.cursorDevice.hasDrumPads().addValueObserver(function (has) {
            self.drumMode = has;
            self.rebuildTable();
        });
        this.drumPadBank = this.cursorDevice.createDrumPadBank(32);
        this.drumPadBank.scrollPosition().addValueObserver(function (pos) {
            self.drumScrollPos = pos;
            self.rebuildTable();
        });
        this.drumPadBank.scrollPosition().set(36);
        for (var i = 0; i < 32; i++) {
            var pad = this.drumPadBank.getItemAt(i);
            pad.exists().markInterested();
            pad.color().markInterested();
        }

        this.cursorTrack.color().markInterested();

        // Step sequencer: 16 steps wide, full key range so y = MIDI key.
        this.cursorClip = host.createLauncherCursorClip(16, 128);
        this.cursorClip.exists().markInterested();
        this.cursorClip.playingStep().markInterested();
        this.stepCount = [];
        for (i = 0; i < 16; i++) this.stepCount[i] = 0;
        this.cursorClip.addStepDataObserver(function (x, y, state) {
            var cell = x + "_" + y;
            var had = !!self.stepHas[cell];
            var has = (state === 2); // 2 = note starts at this step
            if (has && !had) { self.stepHas[cell] = true; self.stepCount[x]++; }
            if (!has && had) { delete self.stepHas[cell]; self.stepCount[x]--; }
        });

        this.rebuildTable();
    },

    /** Called when the UI mode changes (Menu button). */
    setActive: function (active) {
        this.active = active;
        this.rebuildTable();
    },

    /**
     * Key translation: pad note (68-99) -> sounding MIDI key, -1 = silent.
     * Instrument: in-key layout, rows step by 3 scale degrees (fourth-ish).
     * Drum: 32 pads map 1:1 onto the drum pad bank window.
     */
    rebuildTable: function () {
        if (this.noteInput === null) return;
        var table = [];
        for (var i = 0; i < 128; i++) table[i] = -1;

        if (this.active) {
            for (var p = 0; p < 32; p++) {
                var key;
                if (this.drumMode) {
                    key = this.drumScrollPos + p;
                } else {
                    var row = Math.floor(p / 8);
                    var col = p % 8;
                    var degree = row * 3 + col;
                    key = 12 * this.octave + this.rootKey
                        + this.scale[degree % 7]
                        + 12 * Math.floor(degree / 7);
                }
                table[68 + p] = (key >= 0 && key <= 127) ? key : -1;
            }
        }

        this.noteInput.setKeyTranslationTable(table);
    },

    /** Sounding key for a pad note, or -1 (mirrors the translation table). */
    keyForPad: function (note) {
        var p = note - 68;
        if (p < 0 || p > 31 || !this.active) return -1;
        if (this.drumMode) return this.drumScrollPos + p;
        var degree = Math.floor(p / 8) * 3 + (p % 8);
        var key = 12 * this.octave + this.rootKey
            + this.scale[degree % 7] + 12 * Math.floor(degree / 7);
        return (key >= 0 && key <= 127) ? key : -1;
    },

    /**
     * NOTE-mode CC handling: octave / drum-bank navigation and step paging.
     * Everything unhandled falls through to MoveNavigation.
     */
    handleCC: function (cc, value, modifiers) {
        if (value === 0) return false;

        if (cc === MoveHardware.CC.UP || cc === MoveHardware.CC.DOWN) {
            var dir = (cc === MoveHardware.CC.UP) ? 1 : -1;
            if (this.drumMode) {
                var step = modifiers.shift ? 4 : 16;
                var pos = Math.max(0, Math.min(92, this.drumScrollPos + dir * step));
                this.drumPadBank.scrollPosition().set(pos);
            } else {
                this.octave = Math.max(0, Math.min(8, this.octave + dir));
                this.rebuildTable();
            }
            host.requestFlush();
            return true;
        }

        // Plain Left/Right = step-sequencer page; Shift+L/R falls through
        // to MoveNavigation (remote controls page).
        if (cc === MoveHardware.CC.LEFT && !modifiers.shift) {
            this.cursorClip.scrollStepsPageBackwards();
            return true;
        }
        if (cc === MoveHardware.CC.RIGHT && !modifiers.shift) {
            this.cursorClip.scrollStepsPageForward();
            return true;
        }

        // Held step + Volume knob = velocity, + wheel = note length (F19)
        if (this.heldStep >= 0) {
            if (cc === MoveHardware.CC.MASTER) {
                this.adjustStepVelocity(MoveHardware.decodeDelta(value));
                return true;
            }
            if (cc === MoveHardware.CC.JOG_WHEEL) {
                this.adjustStepLength(MoveHardware.decodeDelta(value), modifiers.shift);
                return true;
            }
        }

        return false;
    },

    /** All note-start cells in the held step column: [[x, y], ...] */
    heldStepCells: function () {
        var cells = [];
        for (var cell in this.stepHas) {
            var parts = cell.split("_");
            if (parseInt(parts[0], 10) === this.heldStep) {
                cells.push([this.heldStep, parseInt(parts[1], 10)]);
            }
        }
        return cells;
    },

    adjustStepVelocity: function (delta) {
        if (delta === 0) return;
        this.stepEdited = true;
        var cells = this.heldStepCells();
        var shown = -1;
        for (var i = 0; i < cells.length; i++) {
            var step = this.cursorClip.getStep(0, cells[i][0], cells[i][1]);
            var v = Math.max(0.01, Math.min(1, step.velocity() + delta / 127));
            step.setVelocity(v);
            shown = v;
        }
        if (shown >= 0) MoveNavigation.toast("Velocity " + Math.round(shown * 127));
    },

    adjustStepLength: function (delta, fine) {
        if (delta === 0) return;
        this.stepEdited = true;
        var inc = fine ? 0.0625 : 0.25; // 1/64 or 1/16 note (in beats)
        var cells = this.heldStepCells();
        var shown = -1;
        for (var i = 0; i < cells.length; i++) {
            var step = this.cursorClip.getStep(0, cells[i][0], cells[i][1]);
            var d = Math.max(0.0625, step.duration() + delta * inc);
            step.setDuration(d);
            shown = d;
        }
        if (shown >= 0) MoveNavigation.toast("Length " + shown.toFixed(2) + " beats");
    },

    /** Shift+Step 10: toggle full-velocity pad playing. */
    toggleFullVelocity: function () {
        this.fullVelocity = !this.fullVelocity;
        var table = [];
        for (var i = 0; i < 128; i++) {
            table[i] = this.fullVelocity ? (i === 0 ? 0 : 127) : i;
        }
        this.noteInput.setVelocityTranslationTable(table);
        return this.fullVelocity;
    },

    /**
     * NOTE-mode pad/step note handling.
     * Pads sound via the NoteInput; here we only track the sequencer key.
     * Steps toggle the last played key in the launcher cursor clip.
     */
    handleNote: function (status, note, velocity, modifiers) {
        var isNoteOn = (status & 0xF0) === 0x90 && velocity > 0;

        // Pads (68-99)
        if (note >= MoveHardware.NOTES.PAD_FIRST && note <= MoveHardware.NOTES.PAD_LAST) {
            if (isNoteOn) {
                var key = this.keyForPad(note);
                if (key >= 0) this.lastPlayedKey = key;
            }
            return true; // sound comes from the NoteInput
        }

        // Step buttons (16-31): tap = toggle note at the last played key
        // (committed on release); hold + Volume/wheel = edit velocity/length.
        if (note >= MoveHardware.NOTES.STEP_FIRST && note <= MoveHardware.NOTES.STEP_LAST) {
            var stepIdx = note - MoveHardware.NOTES.STEP_FIRST;
            if (isNoteOn) {
                this.heldStep = stepIdx;
                this.stepEdited = false;
            } else if (this.heldStep === stepIdx) {
                if (!this.stepEdited) {
                    if (this.cursorClip.exists().get()) {
                        this.cursorClip.toggleStep(stepIdx, this.lastPlayedKey, 100);
                    } else {
                        MoveNavigation.toast("No clip selected");
                    }
                }
                this.heldStep = -1;
            }
            return true;
        }

        return false;
    },

    /**
     * NOTE-mode LED painting (pads + steps). Called from flush.
     */
    updateLEDs: function () {
        var i, note, color;

        // Pads
        if (this.drumMode) {
            for (i = 0; i < 32; i++) {
                note = 68 + i;
                var pad = this.drumPadBank.getItemAt(i);
                color = MoveHardware.COLOR.BLACK;
                if (pad.exists().get()) {
                    var c = pad.color();
                    color = MoveHardware.nearestColor(c.red() * 0.6, c.green() * 0.6, c.blue() * 0.6);
                    if (color === 0) color = MoveHardware.COLOR.HAS_CLIP; // uncolored pads: dim white
                }
                MoveProtocol.ledNote(note, color);
            }
        } else {
            var tc = this.cursorTrack.color();
            var rootColor = MoveHardware.nearestColor(tc.red(), tc.green(), tc.blue());
            if (rootColor === 0) rootColor = MoveHardware.COLOR.WHITE;
            for (i = 0; i < 32; i++) {
                note = 68 + i;
                var degree = Math.floor(i / 8) * 3 + (i % 8);
                MoveProtocol.ledNote(note,
                    (degree % 7 === 0) ? rootColor : MoveHardware.COLOR.HAS_CLIP);
            }
        }

        // Steps: white = has notes, green = playhead
        var playing = this.cursorClip.playingStep().get(); // -1 when not playing
        for (i = 0; i < 16; i++) {
            note = MoveHardware.NOTES.STEP_FIRST + i;
            if (i === playing) color = MoveHardware.COLOR.GREEN;
            else if (this.stepCount[i] > 0) color = MoveHardware.COLOR.WHITE;
            else color = MoveHardware.COLOR.BLACK;
            MoveProtocol.ledNote(note, color);
        }
    }
};
