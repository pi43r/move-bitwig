# TODO — Bitwig Move Controller

Ordered backlog. See SPEC.md for the full feature specification and API pointers.
Compilation/on-hardware testing is done manually by the maintainer.

## Done — v0.2.0 "protocol v2" rework (2026-07-12, untested on hardware)

Replaced the CC bridge + text-over-CC with a bidirectional **sysex protocol** (SPEC §2).
Schwung's overtake path forwards cable-2 sysex to `onMidiMessageExternal` (3-byte chunks,
reassembled module-side), and the module can emit arbitrary USB-MIDI packets — including
Move's native **RGB LED sysex** (`F0 00 21 1D 01 01 3B 10 …`), discovered in
`schwung/src/host/shadow_led_queue.c`. Pads/track buttons now get exact Bitwig colors.

- [x] **B1** — full input whitelist (Left/Right/Menu/Back/Capture/Undo/Loop/Copy added)
- [x] **B2** — master knob → master track volume (Shift = fine); knob touch 8 shows it
- [x] **B3** — Shift+Pad now *selects* the clip (manual parity); stop moves to steps later
- [x] **B4** — handlers take an explicit `modifiers` object (shift/del/copy/mute)
- [x] **B5** — progressive LED clear (8/tick) module-side
- [x] **B6/B7** — echo filter & text-over-CC deleted; sysex feedback can't loop by
      construction; module paces all TX (≤12 packets/tick), Bitwig sends diffs only
- [x] **B8** — `decodeMidi()` heuristic removed (host delivers clean 3-byte messages;
      sysex handled by a stateful reassembler)
- [x] **B9** — module id renamed `controller` → `move-bitwig`; stale `dist/control/`
      removed; install.sh cleans old paths
- [x] **I1 (amended)** — `onUnload()` added. Stays `api_version: 1`: version 2 is the
      *DSP plugin* API, not for UI-only modules (schwung's own controller ships 1)
- [x] **I2** — heartbeat/handshake (PING/PONG + HELLO); "Waiting for Bitwig…" screen,
      LED clear on disconnect, full state resend on reconnect
- [x] **I3** — `MoveProtocol` caches desired vs. sent state; diff-only flush
- [x] **I8 (superseded)** — sysex works today via the overtake path; done, not just watched
- [x] **F1** — Undo / Shift+Undo (redo)
- [x] **F2** — Shift+Play = re-trigger; Shift+Rec = launcher overdub toggle
- [x] Groundwork for I4: shared `modifiers` state in `Move.control.js`

**Hardware test results (2026-07-12):**
- [x] 1. Handshake works ("handshake ok", screen leaves "Waiting…") — after fixing a
      double-F0 header bug in `MoveProtocol.js`
- [x] 2. Display lines + knob-touch macro params work
- [x] 3. **RGB sysex verdict**: the `3B 10` idx space is flat, CC numbers own their
      slots — pad notes 68-99 lit knob rings/transport LEDs instead of pads. Fixed:
      pads now use palette via `LED_NOTE` (like Move firmware itself); RGB reserved
      for CC-addressed LEDs. Play was red because palette 127 = red → now 126 (green).
      Bonus discovery: knob rings 71-78 accept RGB sysex (lit accidentally).

**Still to test:**
4. Play (green) / Rec (red) / Mute LEDs; pad colors ≈ clip colors (palette matching);
   track buttons (RGB, scene colors) + Sample ring red when armed; no feedback loops
5. Launch/select/delete clips incl. fast repeated presses (previously eaten by echo filter)
6. Left/Right track-bank scroll + Shift+L/R device select (dead before this rework)
7. Undo/redo, Shift+Play retrigger, Shift+Rec overdub
8. Kill Bitwig → module back to "Waiting…" + LEDs clear; restart Bitwig → auto-reconnect
9. Does Back (CC 51) reach Bitwig, or does the shim suspend the module first?

## Done — v0.3.0 mode framework + manual-parity batch (2026-07-12, untested)

- [x] **I4** — SESSION/NOTE mode framework; **Menu** toggles (Menu LED lit = NOTE),
      held-modifier overlays (Shift/Delete/Copy/Mute-as-hold)
- [x] **F3/F4** — track buttons select tracks 1-4 (white = selected, red = armed, track
      color otherwise); double-press = arm; Shift+Track = launch scene (old behavior);
      Mute+Track = mute; Delete+Track = delete; Copy+Track = duplicate;
      Track-held + Volume knob = that track's volume. Mute button: tap = mute selected
      (Shift+tap = solo), hold = modifier. (Rec+Track arm skipped — Rec acts on press.)
- [x] **F5** — wheel = device prev/next; click = fold/unfold; Mute+click = device on/off
- [x] **F6/I10** — Shift+Left/Right = remote controls page (name toast on OLED);
      knob ring LEDs show mapped param values as brightness (RGB sysex, idx 71-78)
- [x] **F7** — Delete + knob-touch = reset parameter (Shift+knob fine was already in)
- [x] **F8** — SESSION steps: odd = select track 1-8, even = stop track, step 16 = stop all
- [x] **F10** — queued clips blink (~3 Hz flush loop); recording-queued blinks red
- [x] **F11** — Shift+Up/Down = scene page scroll (Shift+L/R is taken by remote pages)
- [x] **F13** — pad on empty slot of an armed track records a new clip (`slot.record()`)
- [x] **F14** — NoteInput plumbing with per-mode key translation table
      (`setShouldConsumeEvents(false)`, pads silent in SESSION mode)
- [x] **F15 (core)** — NOTE instrument sub-mode: in-key major layout (rows +3 degrees),
      root pads = track color, Up/Down = octave; scale/root menu still open (F16)
- [x] **F17 (core)** — drum sub-mode auto-detected (`hasDrumPads`), 32-pad window with
      pad colors, Up/Down = ±16 pads (Shift = ±4)
- [x] **F18 (core)** — step sequencer: steps toggle last-played key in the launcher
      cursor clip, playhead chase LED, Left/Right = step page (16 steps @ 1/16)
- [x] **F19 (core)** — held step + Volume knob = velocity, + wheel = note length
      (Shift = fine); step toggle commits on release when nothing was edited
- [x] **F22 (partial)** — Shift+Step 6 = metronome, Shift+Step 10 = full velocity,
      Shift+Step 15 = double content, Shift+Step 16 = quantize clip;
      Shift+wheel = tempo (1 BPM/detent). Tempo/groove *menus* still open.
- [x] **F24** — Capture = **tap tempo** (Bitwig has no Capture-MIDI API)

**Hardware test checklist v0.3.0:**
1. Menu toggles SESSION/NOTE (toast + Menu LED); pads silent in SESSION, play in NOTE
2. NOTE instrument: in-key layout sounds right, root pads highlighted, octave Up/Down
3. NOTE drum: select a track with a Drum Machine → pads show drum cells, play them
4. Step sequencer: select a clip, toggle steps, playhead chases, L/R pages
5. Track buttons: select / double-press arm / Mute+track / Delete+track / Copy+track;
   held track + Volume knob adjusts that track
6. Mute tap = mute selected, Shift+tap = solo, hold+jog-click = device on/off
7. Wheel: device prev/next, click fold/unfold
8. Shift+L/R remote page toast; knob rings follow macro values
9. SESSION steps: odd select, even stop, 16 = stop all; queued clip blinks
10. Empty slot on armed track records
11. Held step + Volume = velocity, + wheel = length; tap still toggles
12. Shift+Step 6/10/15/16 actions; Shift+wheel = tempo; Capture = tap tempo

## Done — v0.4.0 modes + gestures batch (2026-07-13, untested)

**⚠ Module changed too (new BARS command) — redeploy `dist/` to the Move, not just the
Bitwig script.**

- [x] **F9** — Copy+Pad, then Pad = copy clip between slots
      (`slot.replaceInsertionPoint().copySlotsOrScenes(src)`); toast guides the gesture
- [x] **F12** — Session Overview (Shift+Menu, SESSION only): each pad = 8×4 block,
      white = current window, dim = in project bounds; choosing a block exits overview
- [x] **F15b (chromatic)** — chromatic layout (rows of fourths), toggled in the overlay;
      LEDs: root pads = track color, in-scale = dim white, out-of-scale = off
- [x] **F16** — Key & Scale overlay (Shift+Step 9, NOTE mode): wheel = root,
      Up/Down = scale (10 scales), click = chromatic/in-key, Back or Shift+Step 9 = close;
      pads keep sounding for auditioning
- [x] **F17b (partial)** — drum gestures: Shift+pad = select pad (name toast),
      Mute+pad = pad mute. (Copy+pad device copy still open.)
- [x] **F19b (partial)** — held step + Left/Right = nudge ±1 step, + Up/Down = transpose
      ±1 semitone (Shift = ±12). (Multi-key steps per column still open.)
- [x] **F20** — Loop button: hold + step = loop length in bars (step n = n bars),
      hold + wheel = loop length ±1 bar (Shift = 1/16th steps), tap = arranger loop
      toggle; Loop LED follows arranger loop
- [x] **F22b (groove)** — Shift+Step 7 = global groove on/off (`host.createGroove()`)
- [x] **F23 (bars)** — new protocol cmd `BARS (0x06)`: 8 value bars on the display's
      lower half while any knob is touched (remote values; track volumes in MIXER)
- [x] **F26** — MIXER mode (Menu cycles session→note→mixer, Menu LED dim in mixer):
      knobs = 8 track volumes (Shift = fine, Delete+touch = reset), pad rows top→bottom =
      arm / solo / mute / select, steps keep SESSION select/stop behavior
- [x] **Oklab color matching** — perceptual palette matching (`USE_OKLAB` flag to revert);
      [0,0,0] placeholder palette rows excluded from the search
- [x] **F21** — NOTE mode: Rec = launcher overdub toggle (records pad playing into the
      clip); Shift+Rec = arranger record. Other modes stay reversed. Rec LED follows
      whichever plain Rec toggles in the current mode
- [x] **F19b (chords)** — held pads + step tap writes the whole chord; held step +
      played pads writes them into that step immediately (Push-style, keeps velocity)
- [x] **F15b (sounding pads)** — pads light green while held/sounding (instrument
      incl. duplicate positions, and drum layout)
- [x] **F26b (pan)** — MIXER: Mute-held + knob = track pan (Shift = fine); knob rings
      show track color at volume brightness instead of remote values
- [x] **F22b (quantize amount)** — Shift+Step 3 cycles 100% → 50% → 75%; Shift+Step 16
      quantizes with the chosen amount
- [x] **F15b (degree shift)** — Shift+Up/Down shifts the in-key layout ±1 scale degree
      (clamped ±14, toast; chromatic layout keeps plain octave behavior)

**Hardware test checklist v0.4.0** (after redeploying module + script):
1. Module handshake still ok; knob-touch shows 8 bars on display bottom, hides on release
2. Menu cycles SESSION → NOTE → MIXER (toasts; Menu LED off/bright/dim)
3. MIXER: knobs move volumes, pad rows arm/solo/mute/select, bars = volumes while touched
4. Shift+Menu = overview; white block = window, pad jumps + exits; works from any mode
5. Copy+Pad then Pad copies a clip; Delete+Pad still deletes
6. NOTE: Shift+Step 9 overlay → wheel root, Up/Down scale, click chromatic, Back closes;
   pad layout + root LEDs follow; chromatic LEDs show in-scale pads
7. Held step + Left/Right nudges, + Up/Down transposes (Shift = octave)
8. Loop tap toggles arranger loop (LED); Loop+step = n bars; Loop+wheel = length
9. Shift+Step 7 groove toggle (check Groove panel in Bitwig)
10. Drum mode: Shift+pad selects (toast name), Mute+pad mutes the pad
11. Pad/track colors look closer to Bitwig's (Oklab) — if worse, set `USE_OKLAB = false`
12. NOTE: Rec toggles overdub (toast + LED), Shift+Rec arranger record; pads write into
    a held step; holding a chord + step tap writes all notes; held pads light green
13. MIXER: Mute+knob = pan; rings = track color, brightness = volume
14. Shift+Step 3 cycles quantize amount (toast); Shift+Step 16 uses it
15. NOTE (in-key): Shift+Up/Down shifts layout by a scale degree (root LEDs move)

## Done — v0.5.0 hardware-feedback batch (2026-07-13, untested)

Bitwig-side only — **no module redeploy needed** (module unchanged since 0.4.0).
Driven by v0.4 hardware feedback:

- [x] **Contextual knob display** — the 8-bar overlay is now MIXER-only. Device
      knobs show the touched/turned parameter's *name + value* on the display
      instead (touch beats toasts); ring LEDs already show the other values.
- [x] **Shift-held step LED map** — while Shift is held the step row shows the
      Shift+Step functions: dim white = assigned, green = toggle currently on
      (metronome, groove, full velocity, scale overlay), white = quantize amount.
- [x] **Octave feedback** — Up/Down in NOTE mode toasts "Octave N (C3)"; drum
      window scroll toasts the pad range ("Pads C1-D#2").
- [x] **Overlay remap** — Key & Scale overlay: **Up/Down = octave** (was scale),
      **Left/Right = scale**; wheel = root, click = chromatic as before.
- [x] **F17c — 4×4 drum layout** — left 4×4 = drum pads (bottom-left = lowest,
      16-pad bank window, Up/Down = ±16 / Shift ±4, clamped 0-112); right 4×4 =
      **16 velocity levels** for the last played pad (plays it via
      `cursorTrack.playNote`, writes into a held step, sets the velocity used by
      step taps; current level lit green).
- [x] **F20b — Move-style Loop Mode** — while Loop is held: step LEDs show the
      clip loop (white bars); tap step n = loop bars 1..n, double-tap = just that
      bar, hold A + press B = loop A..B (`getLoopStart`), Loop+Up/Down =
      double/halve length, **Loop+Copy = double clip content**.
- [x] **Global scale (blocked)** — checked the API d.ts through API 21
      (Bitwig 5.3): the project Key/Scale is **not exposed** to controllers.
      The overlay stays the source of truth; revisit when the API grows it.
- [x] **F26c — sends layer** — MIXER: Copy held + knob = Send A,
      Copy+Shift+knob = Send B (bank already had 2 sends); name/value on display
- [x] **F23 (header)** — SESSION/MIXER display line 2 = window position
      ("Trk 1-8  Scn 1-4") instead of the device name
- [x] **F17b (rest)** — drum layout: hold Copy, press source pad, press target
      pad = copy the source pad's (first) device via
      `startOfDeviceChainInsertionPoint().copyDevices()`; releasing Copy
      abandons pending Copy+Pad gestures (clips too, matching the Move manual)
- [x] **Drum pad chain volume** — held drum pad + Volume encoder = that pad's
      chain volume (manual §18.5 parity; Shift = fine, name/value on display)

**Hardware test results v0.5.0 (2026-07-13):**
- Drum 4×4 was **flipped** (C1 top-left instead of bottom-left) — pad index 0
  (note 68) is the *bottom*-left row, same as the instrument layout; the
  `(3-row)` flip was wrong → fixed in v0.6
- Drum Copy+pad device copy **did not work** → removed in v0.6 (not needed)
- Mute+pad worked but gave no LED feedback → v0.6 dims muted pads
- Shift function map lit the step *buttons*; the proper place is the **icon
  LED row below the steps** (CC 16-31, cf. schwung_shim.c Settings/Tools
  icons) → moved in v0.6
- Bars felt obstructive even in MIXER → removed entirely in v0.6
- Sequencer: user expects Move behavior — pressing a pad shows *that pad's*
  sequence in the step row for XO editing → v0.6

## Done — v0.6.0 sequencer + browser batch (2026-07-13)

**Hardware-tested 2026-07-13: no major bugs found — released as v0.6.0
(first public release; release.json + module.json bumped, logo added).**

Bitwig-side only, driven by v0.5 hardware feedback:

- [x] **Drum orientation fixed** — pad note 68 = bottom-left; drum index /
      velocity-level math no longer flips rows (C1 bottom-left, velocity
      soft→loud bottom→top)
- [x] **Per-pad XO sequencer (Move-style)** — the step row now shows the
      sequence of the *selected* note (last played pad; Shift+pad selection
      follows too): white = selected note on that step, dim white = other
      notes there, green = playhead. Step taps toggle that note (unchanged).
- [x] **Drum pad copy/paste removed** (didn't work on hardware, not needed)
- [x] **Muted drum pads dim** — pad LED at ~12% color while muted
      (`pad.mute()` observed)
- [x] **Shift map on the icon row** — the Shift+Step function map moved from
      the step buttons to the icon LEDs below them (CC 16-31); dark when
      Shift is up, so the step buttons keep showing the sequence
- [x] **Bars removed entirely** — `updateBars`/BARS no longer sent (protocol
      cmd 0x06 stays module-side, unused); MIXER knob touch shows the
      volume name/value contextually like device knobs
- [x] **Device management (new)** — `MoveBrowser.js` popup-browser control:
      **Shift+Capture** = add device after current (end of chain if none),
      **Shift+Jog Click** = replace current device, **Delete+Jog Click** =
      delete current device. While the browser is open: wheel = browse
      results, Up/Down = content-type tab, Jog Click = load ("Loaded: X"
      toast), Back = cancel; display shows tab + selection.

**Hardware test checklist v0.6.0** (Bitwig script only):
1. Drum: C1 bottom-left, rising left→right then upward; velocity pads
   soft at bottom, full at top-right
2. Drum: press different pads → step row switches to that pad's sequence
   (white); other pads' steps show dim; step taps XO the selected pad
3. Drum: Mute+pad dims the pad LED immediately; unmute restores color
4. Hold Shift → icon row *below* the steps lights the function map (green =
   metronome/groove/full-velocity/overlay on); step buttons unchanged
      - COMMENT: I dont think that led row is rgb, you can only dim it
5. No bars anywhere; MIXER knob touch/turn shows volume name + value
6. Shift+Capture opens the browser (display shows tab + result); wheel
   scrolls, Up/Down changes tab, click loads, Back cancels
   - COMMENT: SHIFT plus CAPTURE uses Schwung Skipback saved!
7. Shift+Jog Click replaces the current device via browser
8. Delete+Jog Click deletes the current device
9. Instrument NOTE mode: step row = last played note's steps (white), other
   notes dim — chord/held-step gestures unchanged 
   - dim notes is unintuitive, they should not be shown, when nuding those notes it should also only address the currently selected
10. Drum: held pad + Volume encoder = chain volume (v0.5 item, retest)

## Infrastructure / platform
- [ ] **I5 — Shared hardware constants.** Generate/copy one constants file used by both
      `src/ui.js` and `Controller Scripts/MoveHardware.js` so CC numbers can't drift.
- [ ] **I6 — Logging & test setup.** Document `debug_log_on` + `debug.log` tail for the
      module; look at schwung's `tools/pytest-schwung` e2e harness for scripted MIDI
      injection tests against real hardware.
- [x] **I7 (workflow) — Release automation.** `.github/workflows/release.yml`:
      pushing a `v*` tag builds `move-bitwig-module.tar.gz` +
      `move-bitwig-controller-scripts.zip` and publishes the GitHub release
      (guards that module.json/release.json versions match the tag).
- [ ] **I7 (catalog)** — consider a schwung catalog PR once stable.
- [x] **I9 — resolved.** Pads use `LED_NOTE` + `nearestColor()` (palette); RGB sysex
      kept for CC-addressed LEDs only (track row 40-43, Sample 118, knob rings 71-78).
- [x] **I10 — Knob-ring value feedback** — rings 71-78 show macro values as brightness.

## Remaining features

- [ ] **Sequencer rework (post-v0.6 priority).** User: "the sequencer needs more
      work." Candidates to scope: page-follow while playing (playhead beyond 16
      steps), page indicator on the display/icon row, per-step velocity/length
      view, note-length painting (hold step A + press step B = long note),
      swing/repeat integration, and better behavior when the clip is shorter
      than a page.
- [ ] **Global Key & Scale sync** — blocked: not in the controller API (checked
      through API 21 / Bitwig 5.3). Re-check on new Bitwig releases.
- [ ] **F25 — Note repeat** (Shift+Step 11): script-generated repeats while pad held,
      rate menu. Optional / stretch (scheduleTask timing jitter needs a hardware
      feel-test before building the rate menu).
- [ ] Overview polish: green pulse on blocks containing playing clips.
- [ ] Drum Pad sequencer should be all on a different lanes, eg. when kick (c1) is active only show the notes for that lane, when changing to another

## Nice-to-have / research

- [ ] `suspend_keeps_js` + Back handling: jump back to Move browser while Bitwig link
      persists, resume on re-entry (`onResume()` full LED repaint).
- [ ] Aftertouch → channel pressure to Bitwig NoteInput (Move pads send it; check what
      schwung forwards in overtake mode).
- [x] Bitwig popup browser control — done in v0.6 (`MoveBrowser.js`).
- [ ] Java port of the controller script — only if JS API 18 becomes a limiter; not
      needed for speed so far.
