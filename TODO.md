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

## Infrastructure / platform
- [ ] **I5 — Shared hardware constants.** Generate/copy one constants file used by both
      `src/ui.js` and `Controller Scripts/MoveHardware.js` so CC numbers can't drift.
- [ ] **I6 — Logging & test setup.** Document `debug_log_on` + `debug.log` tail for the
      module; look at schwung's `tools/pytest-schwung` e2e harness for scripted MIDI
      injection tests against real hardware.
- [ ] **I7 — Catalog packaging.** `release.json` exists; wire up GitHub release workflow
      (`<id>-module.tar.gz`) so the module installs via schwung-manager, and consider a
      catalog PR once stable.
- [x] **I9 — resolved.** Pads use `LED_NOTE` + `nearestColor()` (palette); RGB sysex
      kept for CC-addressed LEDs only (track row 40-43, Sample 118, knob rings 71-78).
- [x] **I10 — Knob-ring value feedback** — rings 71-78 show macro values as brightness.

## Phase 3 — Session mode completion

- [ ] **F9 — Copy+Pad → Pad clip copy/paste** (`slot.duplicateClip()` / clip content copy),
      Copy+scene = duplicate scene. (Needs API research: cross-slot copy target.)
- [ ] **F12 — Session Overview sub-mode** (Shift+Menu): each pad = 8×4 block via
      `trackBank.scrollPosition()` math; dim = has clips, white = current window,
      green pulse = playing block.

## Phase 4 — Note mode & step sequencer (remaining)

- [ ] **F15b — Instrument layout polish**: chromatic option, Shift+Up/Down = shift by
      scale degree, highlight pads currently sounding.
- [ ] **F16 — Key & scale menu** (Shift+Step 9): root + scale + in-key/chromatic; feeds
      layout and pad LEDs (scale/root state exists in `MoveNotes`).
- [ ] **F17b — Drum sub-mode gestures**: Mute+pad = pad mute, Shift+pad = select pad
      (shows chain on OLED), Copy+pad = copy device between pads.
- [ ] **F19b — Step editing extras**: held step + Left/Right = nudge, + Up/Down =
      transpose; multiple held pads add several notes per step (currently only
      last-played key).
- [ ] **F20 — Loop mode** (Loop button): steps = bars, wheel = loop length
      (Shift = 16th increments). (Double-content and quantize already live on
      Shift+Step 15/16.)
- [ ] **F21 — Note-mode record**: Rec records into selected/next slot
      (`transport.isClipLauncherOverdubEnabled` for overdub).

## Phase 5 — Settings menus & polish

- [ ] **F22b — Settings menus**: groove/shuffle (Shift+Step 7, `host.createGroove()`),
      quantize-amount setting (Shift+Step 3), key & scale menu (Shift+Step 9 = F16).
      Simple toggles (metronome, full velocity, tempo) are already done as actions.
- [ ] **F23 — Display layout v2**: header (mode + window pos), 8 param mini-bars, volume
      bar while Volume touched. Needs protocol extension (SPEC §2.2/§5.6).
- [ ] **F25 — Note repeat** (Shift+Step 11): script-generated repeats while pad held,
      rate menu. Optional / stretch.
- [ ] **F26 — Mixer mode** (Bitwig extra): knobs = 8 track volumes or sends, steps =
      select/stop, pads row = mute/solo/arm per track. Stretch.
- [ ] **F27 — VU meters on OLED** via `track.addVuMeterObserver` once display protocol
      supports widgets. Stretch.

## Nice-to-have / research

- [ ] Perceptual color matching (Oklab) if palette mismatches annoy in practice.
- [ ] `suspend_keeps_js` + Back handling: jump back to Move browser while Bitwig link
      persists, resume on re-entry (`onResume()` full LED repaint).
- [ ] Aftertouch → channel pressure to Bitwig NoteInput (Move pads send it; check what
      schwung forwards in overtake mode).
- [ ] Bitwig popup browser control (wheel = scroll results, click = commit) for inserting
      devices from the hardware.
- [ ] Java port of the controller script — only if JS API 18 becomes a limiter; not
      needed for speed so far.
