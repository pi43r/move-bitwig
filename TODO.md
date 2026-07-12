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

## Infrastructure / platform

- [ ] **I4 — Mode/layer framework in the Bitwig script.** Small state machine: main modes
      (SESSION / NOTE) + held-modifier overlays (Shift/Mute/Delete/Copy/Rec/track-held/
      step-held). Prereq for almost every feature below. (Modifier tracking exists.)
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
- [ ] **I10 — Knob-ring value feedback.** Hardware-confirmed: knob rings 71-78 accept
      RGB sysex. Show macro value as ring brightness (or param color) — pairs with F6.

## Phase 2 — Manual parity: global & tracks
- [ ] **F3 — Track buttons select tracks** (4-track window): white = selected,
      red = armed, track color otherwise. Move scene launch to Shift+Track (or drop —
      scenes are reachable via pads later). Double-press = arm.
- [ ] **F4 — Modifier+Track gestures**: Mute+Track, Shift+Mute+Track (solo),
      Delete+Track, Copy+Track (duplicate), Rec+Track (arm), Track-held+Volume knob.
- [ ] **F5 — Wheel = device navigation** (manual parity): turn = prev/next device,
      click = toggle expand / enter group, Mute+click = device on/off. Move track
      selection off the wheel (tracks now on track buttons / steps).
- [ ] **F6 — Remote-controls paging** on Left/Right while a device param was last touched,
      with page name on OLED; knob indicator LEDs (CC 71–78 out) show mapped params.
- [ ] **F7 — Shift+Knob = fine adjust**; Delete+Knob-tap = `parameter.reset()`.

## Phase 3 — Session mode completion

- [ ] **F8 — Step buttons in Session mode**: odd steps select tracks 1–8, even steps stop
      that track's clip, Step 16 = stop all (`sceneBank.stop()` / per-track `stop()`).
- [ ] **F9 — Copy+Pad → Pad clip copy/paste** (`slot.duplicateClip()` / clip content copy),
      Copy+scene = duplicate scene.
- [ ] **F10 — Queued/recording-queued LED states** (`isPlaybackQueued`,
      `isRecordingQueued`) — blink handling module-side or via flush-tick blinking.
- [ ] **F11 — Shift+arrows = page scroll** (8 tracks / 4 scenes at once).
- [ ] **F12 — Session Overview sub-mode** (Shift+Menu): each pad = 8×4 block via
      `trackBank.scrollPosition()` math; dim = has clips, white = current window,
      green pulse = playing block.
- [ ] **F13 — Empty-slot record**: pad on empty slot of armed track = record new clip
      (`slot.record()`), matching Move behavior.

## Phase 4 — Note mode & step sequencer (the big one)

- [ ] **F14 — NoteInput plumbing**: `midiIn.createNoteInput()` masked to pad notes with
      `setKeyTranslationTable`; enable/disable per mode so pads are notes in NOTE mode and
      clip buttons in SESSION mode.
- [ ] **F15 — Instrument sub-mode**: in-key 8×4 layout (fourths rows), root highlight,
      octave shift on Up/Down (repurposed in NOTE mode), Shift = scale-degree shift.
- [ ] **F16 — Key & scale menu** (Shift+Step 9): root + scale + in-key/chromatic; feeds
      layout and pad LEDs.
- [ ] **F17 — Drum sub-mode**: auto when `cursorDevice.hasDrumPads()`; 32-pad
      `createDrumPadBank(32)` window, pad colors, +/- window paging, Mute+pad = pad mute,
      Shift+pad = select pad (shows chain on OLED).
- [ ] **F18 — Step sequencer core**: `createLauncherCursorClip(16, 128)`, step toggle at
      selected key(s), playhead chase LED, clip-page navigation via Left/Right.
- [ ] **F19 — Step editing**: held step + Volume knob = velocity, + wheel = length,
      + Left/Right = nudge, + plus/minus = transpose (NoteStep API).
- [ ] **F20 — Loop mode** (Loop button): steps = bars, wheel = loop length
      (Shift = 16th increments), Shift+Step 15 = double loop+content, Shift+Step 16 =
      quantize clip.
- [ ] **F21 — Note-mode record**: Rec records into selected/next slot
      (`transport.isClipLauncherOverdubEnabled` for overdub).

## Phase 5 — Settings menus & polish

- [ ] **F22 — Shift+Step settings**: tempo (5, wheel edits), metronome (6),
      groove/shuffle (7), full velocity (10), quantize settings (3). See SPEC §5.7.
- [ ] **F23 — Display layout v2**: header (mode + window pos), 8 param mini-bars, volume
      bar while Volume touched, toast messages. Needs protocol extension (SPEC §2.2/§5.6).
- [ ] **F24 — Capture button re-purpose** (no Capture MIDI in Bitwig API): candidates —
      tap tempo, "prepare next slot", or toggle arranger/launcher focus. Decide & implement.
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
