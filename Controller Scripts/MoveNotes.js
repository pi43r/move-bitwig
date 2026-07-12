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
    degreeOffset: 0,        // in-key layout shift in scale degrees (Shift+Up/Down)
    rootKey: 0,             // 0 = C
    scaleIdx: 0,
    chromatic: false,       // chromatic layout (rows of fourths) vs in-key
    overlayActive: false,   // Key & Scale overlay (Shift+Step 9)
    drumScrollPos: 36,      // first drum pad note in the bank window (16 pads)
    drumVelocity: 100,      // fixed velocity from the right-half level pads
    heldDrumPad: -1,        // held left-half pad (bank index): +Volume = chain vol

    SCALES: [
        ["Major", [0, 2, 4, 5, 7, 9, 11]],
        ["Minor", [0, 2, 3, 5, 7, 8, 10]],
        ["Dorian", [0, 2, 3, 5, 7, 9, 10]],
        ["Mixolydian", [0, 2, 4, 5, 7, 9, 10]],
        ["Lydian", [0, 2, 4, 6, 7, 9, 11]],
        ["Phrygian", [0, 1, 3, 5, 7, 8, 10]],
        ["Harm Minor", [0, 2, 3, 5, 7, 8, 11]],
        ["Minor Pent", [0, 3, 5, 7, 10]],
        ["Major Pent", [0, 2, 4, 7, 9]],
        ["Blues", [0, 3, 5, 6, 7, 10]]
    ],
    ROOT_NAMES: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],

    lastPlayedKey: 60,      // sequencer target key (last pad played)
    heldKeys: {},           // key -> held-pad count (chords onto steps)
    stepHas: {},            // "x_y" -> true for note starts in the clip window
    stepCount: [],          // notes per step column (16)
    heldStep: -1,           // step button currently held (-1 = none)
    stepEdited: false,      // knob/wheel touched while a step was held
    loopAnchorStep: -1,     // loop-held step (range gesture: hold A + press B)
    loopTapStep: -1,        // last loop-mode step tap (double-tap = that bar)
    loopTapTime: 0,
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
        this.drumPadBank = this.cursorDevice.createDrumPadBank(16);
        this.drumPadBank.scrollPosition().addValueObserver(function (pos) {
            self.drumScrollPos = pos;
            self.rebuildTable();
        });
        this.drumPadBank.scrollPosition().set(36);
        for (var i = 0; i < 16; i++) {
            var pad = this.drumPadBank.getItemAt(i);
            pad.exists().markInterested();
            pad.color().markInterested();
            pad.name().markInterested();
            pad.mute().markInterested();
            pad.volume().name().markInterested();
            pad.volume().value().displayedValue().markInterested();
        }

        this.cursorTrack.color().markInterested();

        // Step sequencer: 16 steps wide, full key range so y = MIDI key.
        this.cursorClip = host.createLauncherCursorClip(16, 128);
        this.cursorClip.exists().markInterested();
        this.cursorClip.playingStep().markInterested();
        this.cursorClip.getLoopLength().markInterested();
        this.cursorClip.getLoopStart().markInterested();
        this.cursorClip.isLoopEnabled().markInterested();
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
        if (!active) this.overlayActive = false;
        this.heldKeys = {};
        this.heldDrumPad = -1;
        this.rebuildTable();
    },

    scale: function () {
        return this.SCALES[this.scaleIdx][1];
    },

    /**
     * Key translation: pad note (68-99) -> sounding MIDI key, -1 = silent.
     * Instrument: in-key layout, rows step by 3 scale degrees (fourth-ish).
     * Drum: 32 pads map 1:1 onto the drum pad bank window.
     */
    rebuildTable: function () {
        if (this.noteInput === null) return;
        this.heldKeys = {}; // layout changed: note-offs would mismatch
        var table = [];
        for (var i = 0; i < 128; i++) table[i] = -1;

        if (this.active) {
            for (var p = 0; p < 32; p++) {
                var key = this.keyForPadIndex(p);
                table[68 + p] = (key >= 0 && key <= 127) ? key : -1;
            }
        }

        this.noteInput.setKeyTranslationTable(table);
    },

    /** MIDI note name in Move/Live convention (note 0 = C-2). */
    noteName: function (key) {
        return this.ROOT_NAMES[key % 12] + (Math.floor(key / 12) - 2);
    },

    /** Drum-bank index (0-15) for a left-half pad index, bottom-left = 0.
     *  (Pad index 0 = note 68 = bottom-left row, like the instrument layout.) */
    drumIndexForPad: function (p) {
        return Math.floor(p / 8) * 4 + (p % 8);
    },

    /** Sounding key for pad index 0-31 (may be out of MIDI range). */
    keyForPadIndex: function (p) {
        var row = Math.floor(p / 8);
        var col = p % 8;
        if (this.drumMode) {
            // Left 4x4 = drum pads (bottom-left = lowest); right half is
            // velocity levels, silent in the translation table.
            if (col >= 4) return -1;
            return this.drumScrollPos + row * 4 + col;
        }
        if (this.chromatic) {
            // Rows of fourths (+5 semitones per row)
            return 12 * this.octave + this.rootKey + row * 5 + col;
        }
        var scale = this.scale();
        var degree = row * 3 + col + this.degreeOffset;
        var oct = Math.floor(degree / scale.length);
        return 12 * this.octave + this.rootKey
            + scale[degree - oct * scale.length]  // proper mod for negatives
            + 12 * oct;
    },

    /** Sounding key for a pad note, or -1 (mirrors the translation table). */
    keyForPad: function (note) {
        var p = note - 68;
        if (p < 0 || p > 31 || !this.active) return -1;
        var key = this.keyForPadIndex(p);
        return (key >= 0 && key <= 127) ? key : -1;
    },

    /**
     * NOTE-mode CC handling: octave / drum-bank navigation and step paging.
     * Everything unhandled falls through to MoveNavigation.
     */
    handleCC: function (cc, value, modifiers) {
        if (value === 0) return false;

        // Held step: Volume = velocity, wheel = length, Up/Down = transpose,
        // Left/Right = nudge by one step (F19)
        if (this.heldStep >= 0) {
            if (cc === MoveHardware.CC.MASTER) {
                this.adjustStepVelocity(MoveHardware.decodeDelta(value));
                return true;
            }
            if (cc === MoveHardware.CC.JOG_WHEEL) {
                this.adjustStepLength(MoveHardware.decodeDelta(value), modifiers.shift);
                return true;
            }
            if (cc === MoveHardware.CC.UP || cc === MoveHardware.CC.DOWN) {
                var dy = (cc === MoveHardware.CC.UP) ? 1 : -1;
                if (modifiers.shift) dy *= 12;
                this.moveHeldStep(0, dy, "Transposed");
                return true;
            }
            if (cc === MoveHardware.CC.LEFT || cc === MoveHardware.CC.RIGHT) {
                this.moveHeldStep((cc === MoveHardware.CC.RIGHT) ? 1 : -1, 0, "Nudged");
                return true;
            }
        }

        // Held drum pad + Volume encoder = that pad's chain volume (manual §18.5)
        if (this.drumMode && this.heldDrumPad >= 0
            && cc === MoveHardware.CC.MASTER) {
            var padVol = this.drumPadBank.getItemAt(this.heldDrumPad).volume();
            padVol.inc(MoveHardware.decodeDelta(value), modifiers.shift ? 512 : 128);
            MoveNavigation.activeParameter = padVol;
            host.requestFlush();
            return true;
        }

        // Loop held + Up/Down = double / halve the clip loop length
        if (modifiers.loop && (cc === MoveHardware.CC.UP || cc === MoveHardware.CC.DOWN)) {
            modifiers.loopUsed = true;
            if (!this.cursorClip.exists().get()) return true;
            var curLen = this.cursorClip.getLoopLength().get();
            var newLen = (cc === MoveHardware.CC.UP)
                ? Math.min(1024, curLen * 2)
                : Math.max(1, curLen / 2);
            this.cursorClip.getLoopLength().set(newLen);
            this.cursorClip.isLoopEnabled().set(true);
            MoveNavigation.toast("Loop " + (newLen / 4) + " bars");
            host.requestFlush();
            return true;
        }

        // Loop held + wheel = clip loop length (F20)
        if (modifiers.loop && cc === MoveHardware.CC.JOG_WHEEL) {
            modifiers.loopUsed = true;
            if (!this.cursorClip.exists().get()) return true;
            var d = MoveHardware.decodeDelta(value) * (modifiers.shift ? 0.25 : 4.0);
            var len = Math.max(0.25, this.cursorClip.getLoopLength().get() + d);
            this.cursorClip.getLoopLength().set(len);
            this.cursorClip.isLoopEnabled().set(true);
            MoveNavigation.toast("Loop " + (len / 4) + " bars");
            return true;
        }

        if (cc === MoveHardware.CC.UP || cc === MoveHardware.CC.DOWN) {
            var dir = (cc === MoveHardware.CC.UP) ? 1 : -1;
            if (this.drumMode) {
                var step = modifiers.shift ? 4 : 16;
                var pos = Math.max(0, Math.min(112, this.drumScrollPos + dir * step));
                this.drumPadBank.scrollPosition().set(pos);
                MoveNavigation.toast("Pads " + this.noteName(pos)
                    + "-" + this.noteName(pos + 15));
            } else if (modifiers.shift && !this.chromatic) {
                // Shift+Up/Down: shift the in-key layout by one scale degree
                this.degreeOffset = Math.max(-14, Math.min(14, this.degreeOffset + dir));
                this.rebuildTable();
                MoveNavigation.toast("Layout " +
                    (this.degreeOffset >= 0 ? "+" : "") + this.degreeOffset + " deg");
            } else {
                this.octave = Math.max(0, Math.min(8, this.octave + dir));
                this.rebuildTable();
                MoveNavigation.toast("Octave " + this.octave + "  ("
                    + this.noteName(12 * this.octave + this.rootKey) + ")");
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

        return false;
    },

    /**
     * Key & Scale overlay (Shift+Step 9): wheel = root, Up/Down = octave,
     * Left/Right = scale, click = toggle chromatic/in-key layout,
     * Back/Shift+Step 9 = close.
     * Pads keep playing so changes can be auditioned live.
     * Returns true when the CC was consumed by the overlay.
     */
    handleOverlayCC: function (cc, value) {
        if (value === 0) return false;

        if (cc === MoveHardware.CC.JOG_WHEEL) {
            var d = MoveHardware.decodeDelta(value);
            if (d !== 0) {
                this.rootKey = ((this.rootKey + d) % 12 + 12) % 12;
                this.rebuildTable();
                host.requestFlush();
            }
            return true;
        }
        if (cc === MoveHardware.CC.UP || cc === MoveHardware.CC.DOWN) {
            var dir = (cc === MoveHardware.CC.UP) ? 1 : -1;
            this.octave = Math.max(0, Math.min(8, this.octave + dir));
            this.rebuildTable();
            host.requestFlush();
            return true;
        }
        if (cc === MoveHardware.CC.LEFT || cc === MoveHardware.CC.RIGHT) {
            var sdir = (cc === MoveHardware.CC.RIGHT) ? 1 : -1;
            var n = this.SCALES.length;
            this.scaleIdx = ((this.scaleIdx + sdir) % n + n) % n;
            this.rebuildTable();
            host.requestFlush();
            return true;
        }
        if (cc === MoveHardware.CC.JOG_CLICK) {
            if (value === 127) {
                this.chromatic = !this.chromatic;
                this.rebuildTable();
                host.requestFlush();
            }
            return true;
        }
        if (cc === MoveHardware.CC.BACK) {
            this.overlayActive = false;
            host.requestFlush();
            return true;
        }
        return false;
    },

    /** Overlay display content (replaces the normal display while open). */
    updateOverlayDisplay: function () {
        MoveProtocol.text(1, "* Key & Scale *");
        MoveProtocol.text(2, "Root:  " + this.ROOT_NAMES[this.rootKey]
            + "  Oct: " + this.octave);
        MoveProtocol.text(3, "Scale: " + this.SCALES[this.scaleIdx][0]);
        MoveProtocol.text(4, this.chromatic ? "Layout: Chromatic" : "Layout: In Key");
    },

    /** Move all notes in the held step by (dx steps, dy semitones). */
    moveHeldStep: function (dx, dy, label) {
        this.stepEdited = true;
        var cells = this.heldStepCells();
        for (var i = 0; i < cells.length; i++) {
            this.cursorClip.moveStep(cells[i][0], cells[i][1], dx, dy);
        }
        if (cells.length > 0) {
            MoveNavigation.toast(label);
            // Follow transposes so a repeated tap toggles the same note.
            // (heldStep stays on the physical button — nudged notes move
            // out from under it, which matches Move's behavior.)
            if (dy !== 0) this.lastPlayedKey = Math.max(0, Math.min(127, this.lastPlayedKey + dy));
        }
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
            var key = this.keyForPad(note);
            // Drum sub-mode, right 4x4 = 16 velocity levels for the last
            // played pad (bottom-left soft, top-right full).
            if (this.drumMode && (note - 68) % 8 >= 4) {
                if (isNoteOn) {
                    var lvRow = Math.floor((note - 68) / 8);
                    var level = lvRow * 4 + ((note - 68) % 8 - 4);
                    this.drumVelocity = Math.round((level + 1) * 127 / 16);
                    this.cursorTrack.playNote(this.lastPlayedKey, this.drumVelocity);
                    if (this.heldStep >= 0 && this.cursorClip.exists().get()) {
                        this.cursorClip.toggleStep(this.heldStep,
                            this.lastPlayedKey, this.drumVelocity);
                        this.stepEdited = true;
                    }
                    MoveNavigation.toast("Velocity " + this.drumVelocity);
                    host.requestFlush();
                }
                return true;
            }
            if (isNoteOn) {
                // Drum sub-mode gestures (F17b)
                if (this.drumMode) {
                    var padIdx2 = this.drumIndexForPad(note - 68);
                    var padItem = this.drumPadBank.getItemAt(padIdx2);
                    if (modifiers.shift) {
                        padItem.selectInEditor();
                        // Step row follows the selected pad's sequence
                        if (key >= 0) this.lastPlayedKey = key;
                        MoveNavigation.toast(padItem.name().get() || "Pad");
                        host.requestFlush();
                        return true;
                    }
                    if (modifiers.mute) {
                        padItem.mute().toggle();
                        modifiers.muteUsed = true;
                        return true;
                    }
                }
                if (key >= 0) {
                    this.lastPlayedKey = key;
                    if (this.drumMode) this.heldDrumPad = this.drumIndexForPad(note - 68);
                    this.heldKeys[key] = (this.heldKeys[key] || 0) + 1;
                    // Held step + pad = write that note into the step (Push-style)
                    if (this.heldStep >= 0 && this.cursorClip.exists().get()) {
                        this.cursorClip.toggleStep(this.heldStep, key, velocity);
                        this.stepEdited = true;
                    }
                    host.requestFlush(); // sounding-pad highlight
                }
            } else {
                if (this.drumMode
                    && this.heldDrumPad === this.drumIndexForPad(note - 68)) {
                    this.heldDrumPad = -1;
                }
                if (key >= 0 && this.heldKeys[key]) {
                    if (--this.heldKeys[key] <= 0) delete this.heldKeys[key];
                    host.requestFlush();
                }
            }
            return true; // sound comes from the NoteInput
        }

        // Step buttons (16-31): tap = toggle note at the last played key
        // (committed on release); hold + Volume/wheel = edit velocity/length.
        if (note >= MoveHardware.NOTES.STEP_FIRST && note <= MoveHardware.NOTES.STEP_LAST) {
            var stepIdx = note - MoveHardware.NOTES.STEP_FIRST;

            // Loop held: steps = bars, Move-style (§18 Loop Mode).
            // Tap bar n = loop bars 1..n; hold bar A + press bar B = loop
            // A..B; double-tap a bar = loop just that bar.
            if (modifiers.loop) {
                modifiers.loopUsed = true;
                if (isNoteOn) {
                    if (!this.cursorClip.exists().get()) return true;
                    var now = Date.now();
                    if (this.loopAnchorStep >= 0 && this.loopAnchorStep !== stepIdx) {
                        var a = Math.min(this.loopAnchorStep, stepIdx);
                        var b = Math.max(this.loopAnchorStep, stepIdx);
                        this.cursorClip.getLoopStart().set(a * 4);
                        this.cursorClip.getLoopLength().set((b - a + 1) * 4);
                        MoveNavigation.toast("Loop bars " + (a + 1) + "-" + (b + 1));
                    } else if (this.loopTapStep === stepIdx
                        && now - this.loopTapTime < 500) {
                        this.cursorClip.getLoopStart().set(stepIdx * 4);
                        this.cursorClip.getLoopLength().set(4);
                        MoveNavigation.toast("Loop bar " + (stepIdx + 1));
                    } else {
                        this.loopAnchorStep = stepIdx;
                        this.cursorClip.getLoopStart().set(0);
                        this.cursorClip.getLoopLength().set((stepIdx + 1) * 4);
                        MoveNavigation.toast("Loop " + (stepIdx + 1) + " bars");
                    }
                    this.cursorClip.isLoopEnabled().set(true);
                    this.loopTapStep = stepIdx;
                    this.loopTapTime = now;
                    host.requestFlush();
                } else if (this.loopAnchorStep === stepIdx) {
                    this.loopAnchorStep = -1;
                }
                return true;
            }
            if (isNoteOn) {
                this.heldStep = stepIdx;
                this.stepEdited = false;
            } else if (this.heldStep === stepIdx) {
                if (!this.stepEdited) {
                    if (this.cursorClip.exists().get()) {
                        // Held pads = write the whole chord, else last played key
                        var keys = [];
                        for (var k in this.heldKeys) keys.push(parseInt(k, 10));
                        if (keys.length === 0) keys.push(this.lastPlayedKey);
                        var vel = this.drumMode ? this.drumVelocity : 100;
                        for (var j = 0; j < keys.length; j++) {
                            this.cursorClip.toggleStep(stepIdx, keys[j], vel);
                        }
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
                if (i % 8 >= 4) {
                    // Right 4x4: velocity levels; current level lit green
                    var lvl = Math.floor(i / 8) * 4 + (i % 8 - 4);
                    var lvlVel = Math.round((lvl + 1) * 127 / 16);
                    color = (lvlVel === this.drumVelocity)
                        ? MoveHardware.COLOR.GREEN : MoveHardware.COLOR.HAS_CLIP;
                } else {
                    var padIdx = this.drumIndexForPad(i);
                    var pad = this.drumPadBank.getItemAt(padIdx);
                    color = MoveHardware.COLOR.BLACK;
                    if (this.heldKeys[this.drumScrollPos + padIdx]) {
                        color = MoveHardware.COLOR.GREEN; // sounding
                    } else if (pad.exists().get()) {
                        var c = pad.color();
                        var dim = pad.mute().get() ? 0.12 : 0.6; // muted = dimmed
                        color = MoveHardware.nearestColor(c.red() * dim, c.green() * dim, c.blue() * dim);
                        if (color === 0) {
                            color = pad.mute().get()
                                ? 76 : MoveHardware.COLOR.HAS_CLIP; // dark fallback
                        }
                    }
                }
                MoveProtocol.ledNote(note, color);
            }
        } else {
            var tc = this.cursorTrack.color();
            var rootColor = MoveHardware.nearestColor(tc.red(), tc.green(), tc.blue());
            if (rootColor === 0) rootColor = MoveHardware.COLOR.WHITE;
            var scale = this.scale();
            for (i = 0; i < 32; i++) {
                note = 68 + i;
                if (this.heldKeys[this.keyForPadIndex(i)]) {
                    color = MoveHardware.COLOR.GREEN; // sounding (incl. duplicates)
                } else if (this.chromatic) {
                    // Root pads = track color, in-scale = dim white, rest = off
                    var pc = ((this.keyForPadIndex(i) - this.rootKey) % 12 + 12) % 12;
                    if (pc === 0) color = rootColor;
                    else if (scale.indexOf(pc) >= 0) color = MoveHardware.COLOR.HAS_CLIP;
                    else color = MoveHardware.COLOR.BLACK;
                } else {
                    var degree = Math.floor(i / 8) * 3 + (i % 8) + this.degreeOffset;
                    var dmod = ((degree % scale.length) + scale.length) % scale.length;
                    color = (dmod === 0) ? rootColor : MoveHardware.COLOR.HAS_CLIP;
                }
                MoveProtocol.ledNote(note, color);
            }
        }

        // Steps show the *selected* note's sequence (last played / selected
        // pad, Move-style XO): white = selected note here, dim = other notes,
        // green = playhead.
        var playing = this.cursorClip.playingStep().get(); // -1 when not playing
        for (i = 0; i < 16; i++) {
            note = MoveHardware.NOTES.STEP_FIRST + i;
            if (i === playing) color = MoveHardware.COLOR.GREEN;
            else if (this.stepHas[i + "_" + this.lastPlayedKey]) color = MoveHardware.COLOR.WHITE;
            else if (this.stepCount[i] > 0) color = MoveHardware.COLOR.HAS_CLIP;
            else color = MoveHardware.COLOR.BLACK;
            MoveProtocol.ledNote(note, color);
        }
    },

    /**
     * While Loop is held (Move-style Loop Mode): each step = one bar,
     * white = inside the clip loop. Painted over the step row from flush.
     */
    updateLoopStepLEDs: function () {
        var startBar = Math.round(this.cursorClip.getLoopStart().get() / 4);
        var endBar = startBar
            + Math.max(1, Math.round(this.cursorClip.getLoopLength().get() / 4));
        for (var i = 0; i < 16; i++) {
            var color = (i >= startBar && i < endBar)
                ? MoveHardware.COLOR.WHITE : MoveHardware.COLOR.HAS_CLIP;
            MoveProtocol.ledNote(MoveHardware.NOTES.STEP_FIRST + i, color);
        }
    }
};
