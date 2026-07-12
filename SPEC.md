# SPEC — Bitwig Move Controller

Turn the Ableton Move into a deeply integrated Bitwig Studio control surface, aiming for
feature parity with Move's official "Control Live Mode" (see `../MOVE_CONTROL_LIVE_MANUAL.md`),
plus Bitwig-specific extras where the API allows.

## 1. System Architecture

```
┌────────────────────┐   USB MIDI (1 in / 1 out)   ┌─────────────────────────────┐
│  Bitwig Studio     │ ←─────────────────────────→ │  Ableton Move               │
│  Move.control.js   │                             │  schwung overtake module    │
│  (JS Controller    │   Notes / CCs / bridge CCs  │  src/ui.js                  │
│   Script, API 18)  │   Text-over-CC protocol     │  (QuickJS, owns OLED+LEDs)  │
└────────────────────┘                             └─────────────────────────────┘
```

Two cooperating programs:

1. **Move module** (`src/ui.js`, schwung overtake module) — runs on the Move. Owns the
   128x64 OLED, translates "virtual" bridge CCs into LED writes, filters hardware noise and
   LED echoes, and forwards whitelisted hardware input to Bitwig on the external USB cable.
2. **Bitwig controller script** (`Controller Scripts/*.js`) — runs in Bitwig. Owns all
   state and observers, decides what every control does per mode, sends LED feedback and
   display text back to the module.

**Design rule:** the module stays dumb and stateless where possible. All musical/mode logic
lives in the Bitwig script, so iterating doesn't require redeploying to the device.

## 2. Protocol v2 (sysex)

> Protocol v1 (Middleman CC bridge + text-over-CC) is retired. Schwung's overtake path
> forwards **all cable-2 traffic — including sysex — to the module**
> (`shadow_ui_midi_publish` in `schwung_shim.c`, consumed by
> `process_shadow_midi` in `shadow_ui.c`), and `move_midi_external_send` /
> `move_midi_internal_send` accept arbitrary USB-MIDI packets (any CIN, multi-packet
> arrays). So both directions speak real sysex now.

**Core idea:** all Bitwig → Move feedback (display text, LEDs) is sysex; all hardware
input Move → Bitwig stays plain notes/CCs. Since input and feedback no longer share
message types, **feedback loops are impossible by construction** — no bridge CCs, no
echo filters, no `lastSentLED` heuristics.

### 2.1 Framing

```
F0 7D 4D 42 <cmd> <payload...> F7          (0x7D = educational/dev ID, "MB" magic)
```

| Cmd | Dir | Payload | Meaning |
| --- | --- | --- | --- |
| `0x00` PING | B→M | `seq` | heartbeat (1 s interval) |
| `0x01` TEXT | B→M | `line(0-3), ascii...` | replace one display line |
| `0x02` LED_NOTE | B→M | `(note, color)*` | palette LED via note address (pads/steps) |
| `0x03` LED_CC | B→M | `(cc, color)*` | palette/brightness LED via CC address (buttons) |
| `0x04` LED_RGB | B→M | `(idx, r7, g7, b7)*` | **direct RGB** (7-bit/channel) |
| `0x05` CLEAR | B→M | — | all LEDs off (progressive) |
| `0x06` BARS | B→M | `(v 0-127)×8` or empty | 8 value bars on the lower display half (empty payload hides them) |
| `0x7E` HELLO | B→M | `protoVer` | handshake on Bitwig init |
| `0x40` PONG | M→B | `seq` | heartbeat reply |
| `0x41` HELLO_ACK | M→B | `protoVer` | handshake reply |

Connection state: the module shows "Waiting for Bitwig…" until protocol traffic arrives
and drops back to it (clearing LEDs) after 4 s of silence. Bitwig marks the link lost
after 3.5 s without PONG and resends full state on reconnect.

### 2.2 Direct RGB LEDs (CC-addressed only)

Move's firmware drives its **CC-addressed** RGB LEDs (track row, knob rings, transport,
Sample ring) with an Ableton sysex the module can emit itself on cable 0 (format from
`schwung/src/host/shadow_led_queue.c`):

```
F0 00 21 1D 01 01 3B 10 <idx> <r_lo> <r_hi> <g_lo> <g_hi> <b_lo> <b_hi> F7
```

`idx` = the LED's CC number; `lo/hi` = 7-bit split of an 8-bit channel value.
**The index space is flat and CC numbers own their slots** — hardware-verified
(2026-07-12): sending pad note numbers 68–99 as idx lit the knob rings (71–78) and
transport LEDs (85/86) instead of pads. Therefore:

- **Pads and step buttons: palette colors via note-on (`LED_NOTE`)** — the same
  mechanism Move firmware uses — with `nearestColor()` matching Bitwig-side.
- **Track buttons (40–43), Sample ring (118), knob rings (71–78): direct RGB.**
  Knob rings via RGB are confirmed working (accidentally) — future use: macro value /
  parameter color feedback.
- Play (85) / Rec (86) are RGB but simple palette values via `LED_CC` suffice
  (palette: 125 = blue, 126 = green, 127 = red).

### 2.3 Rate limiting

The hardware MIDI_OUT mailbox holds 20 packets per ~2.9 ms frame, shared with the shim's
own LED queue. Discipline on both ends:

- **Module:** all self-generated sysex (RGB LEDs, PONGs) goes through a FIFO drained at
  ≤ 12 packets/tick. Palette LEDs use `setLED`/`setButtonLED`, which ride the shim's
  rate-limited LED queue. LED clearing is progressive (8/tick).
- **Bitwig:** `MoveProtocol` caches desired state and sends **diffs only** on `flush()`,
  chunked (≤ 16 palette pairs / ≤ 8 RGB quads per sysex). A full 32-pad RGB repaint is
  32 × 6 = 192 packets ≈ 50 ms — acceptable for the rare worst case.

### 2.4 Input forwarding (module → Bitwig)

The module forwards whitelisted hardware controls verbatim on cable 2 (`FORWARD_CC` /
`FORWARD_NOTES` in `src/ui.js`): all buttons (incl. Menu/Back/Capture/Undo/Loop/Copy),
arrows, knobs, jog, track buttons, pads, steps, knob-touch notes 0–9. Aftertouch is
dropped for now (revisit for Note mode). **Every control the Bitwig script wants must be
in the whitelist.**

## 3. Hardware Reference

Physical controls (from schwung `constants.mjs` / `UI_OVER_MIDI.md`), all channel 1:

| Control | MIDI | Notes |
| --- | --- | --- |
| Pads 8×4 | Notes 68–99 | bottom-left → top-right, velocity + aftertouch |
| Step buttons 1–16 | Notes 16–31 | LED via note velocity |
| Knob touch | Notes 0–9 | 0–7 = knobs, 8 = master, 9 = wheel |
| Knobs 1–8 | CC 71–78 | relative: 1–63 CW, 65–127 CCW |
| Master knob | CC 79 | relative, no LED (module claims it via `claims_master_knob`) |
| Jog wheel | CC 14 (turn), CC 3 (click) | relative |
| Track buttons 1–4 | CC 43, 42, 41, 40 | **reversed**: CC 43 = Track 1; RGB LEDs |
| Play / Rec | CC 85 / 86 | white / red LED |
| Shift / Menu / Back | CC 49 / 50 / 51 | |
| Capture / Undo | CC 52 / 56 | |
| Loop / Copy / Delete | CC 58 / 60 / 119 | |
| Mute | CC 88 | white LED only |
| Up / Down / Left / Right | CC 55 / 54 / 62 / 63 | |
| Sample button | CC 118 | RGB LED |
| Knob indicator LEDs | CC 71–78 (out) | |

Colors: 128-entry fixed palette (index = velocity/CC value). Bitwig-side nearest-neighbor
matching in `MoveHardware.nearestColor()`; useful constants in `MoveHardware.COLOR`.

## 4. Interaction Model

A **mode/layer state machine** in the Bitwig script (to be built — currently everything is
one implicit mode). Mirrors Move's Control Live model:

```
Global layer (always active): transport, Shift, modifiers, wheel, knobs, display
└── Main mode (exclusive):
    ├── SESSION  — pads = 8×4 clip launcher, steps = track select/stop
    │   └── sub: Session Overview (Shift+mode toggle)
    ├── NOTE     — pads = playable notes, steps = step sequencer
    │   ├── sub: Instrument (scale/isomorphic layout)
    │   └── sub: Drum (cursor track has Drum Machine → 32 drum pads)
    └── (later) MIXER — steps/pads = volume/pan/send strips
Overlay layers (while held): Shift, Mute, Delete, Copy, Rec, track-button-held, step-held
```

**Modifiers are hold-buttons, not toggles**: Mute/Delete/Copy/Shift each arm an overlay that
re-interprets the next pressed control, exactly like the Move manual (e.g. Delete+pad =
delete clip, Copy+track = duplicate track, Mute+wheel-click = disable device).

Mode toggle: **Menu button** (CC 50) cycles Session ↔ Note (Move has no dedicated
Note/Session button; Menu is the nearest equivalent). Shift+Menu = sub-mode toggle
(Session Overview / settings).

## 5. Feature Specification

Mapping of the Move Control Live manual (§18) onto Bitwig API concepts. ✅ = already works,
🔶 = partial, ⬜ = planned. See TODO.md for ordering.

### 5.1 Transport & global

| Control | Action | Bitwig API | Status |
| --- | --- | --- | --- |
| Play | toggle play/stop | `transport.isPlaying().toggle()` | ✅ |
| Shift+Play | re-trigger from start | `transport.restart()` / `.launchFromPlayStartPosition()` | ⬜ |
| Rec | arranger record | `transport.isArrangerRecordEnabled()` | ✅ |
| Shift+Rec | launcher overdub | `transport.isClipLauncherOverdubEnabled()` | ⬜ |
| Undo / Shift+Undo | undo / redo | `application.undo()/redo()` | ⬜ |
| Capture | (Bitwig has no Capture-MIDI) → map to "new clip / continue" or tap tempo | TBD | ⬜ |
| Loop | arranger loop toggle (Session) / clip loop-length mode (Note) | `transport.isArrangerLoopEnabled()` | ⬜ |
| Metronome (Shift+Step 6) | toggle click | `transport.isMetronomeEnabled()` | ⬜ |
| Tempo (Shift+Step 5) | wheel sets tempo | `transport.tempo().incRaw()` | ⬜ |
| Groove (Shift+Step 7) | wheel sets global shuffle | `host.createGroove()` | ⬜ |

### 5.2 Tracks

Track buttons 1–4 select tracks (manual-parity — replaces the current scene-launch mapping;
scenes move to Shift+track or a dedicated column, see 5.4):

| Gesture | Action | Bitwig API |
| --- | --- | --- |
| Track button | select track *n* of a 4-track window | `trackBank(4).getItemAt(n).selectInEditor()` |
| Track button ×2 or Rec+Track | arm | `track.arm()` |
| Mute+Track | mute | `track.mute()` |
| Shift+Mute+Track | solo | `track.solo()` |
| Delete+Track | delete track | `track.deleteObject()` |
| Copy+Track | duplicate track | `track.duplicate()` |
| Track held + Volume knob | that track's volume | `track.volume().inc()` |
| Track LED | white = selected, red = armed, else track color | color observers |

Volume knob default = **Master volume** (`host.createMasterTrack()`), matching the manual —
currently it moves cursor-track volume (mismatch, see TODO).

### 5.3 Device & parameters

| Gesture | Action | Bitwig API | Status |
| --- | --- | --- | --- |
| Knobs 1–8 | remote controls page | `cursorRemoteControlsPage` | ✅ |
| Knob touch | show param name/value on OLED | touch notes 0–8 | ✅ |
| Shift+Knob | fine increment | smaller `inc` denominator | ⬜ |
| Wheel | navigate devices in chain | `cursorDevice.selectNext/Previous()` | 🔶 (currently on Shift+arrows) |
| Wheel click | expand/collapse device / enter group | `cursorDevice.isExpanded()` / `selectFirstInSlot` | ⬜ |
| Mute+Wheel click | toggle device enabled | `cursorDevice.isEnabled().toggle()` | ⬜ |
| Left/Right (device ctx) | remote-controls page prev/next | `remoteControls.selectPrevious/NextPage()` | ⬜ |
| Delete+Knob tap | reset parameter | `parameter.reset()` | ⬜ |
| Knob indicator LEDs | show mapped/active params | CC 71–78 out | ⬜ |

### 5.4 Session mode (pads + steps)

8 tracks × 4 scenes window via `createMainTrackBank(8, 0, 4)`:

| Gesture | Action | Status |
| --- | --- | --- |
| Pad | launch clip / record into empty slot on armed track | ✅ |
| Shift+Pad | select clip slot (no launch) | ⬜ (currently stops track) |
| Delete+Pad | delete clip | ✅ |
| Copy+Pad, then Pad | copy clip → paste to target slot | ⬜ |
| Steps 1,3,…,15 (odd) | select track 1–8 | ⬜ |
| Steps 2,4,…,16 (even) | stop clip in track 1–8; Step 16 = stop all | ⬜ |
| Track buttons | launch scene 1–4 → **reassign** per 5.2; scene launch moves to Shift+Track | 🔶 |
| Left/Right | move track window | ✅ (once CC whitelist fixed) |
| Up/Down | move scene window | ✅ |
| Shift+arrows | move by page (8 tracks / 4 scenes) | ⬜ |
| Pad LEDs | clip color; dimmed = stopped, bright = playing, red = recording, blinking = queued | 🔶 (no queued state) |
| Session Overview (Shift+Menu) | each pad = 8×4 block, jump the window | ⬜ |

### 5.5 Note mode (pads) + step sequencer (steps)

The big missing piece. Requires a `NoteInput` on the pad note range with a
translation table (`setKeyTranslationTable`) so pads play the cursor track directly with
velocity, switchable off when pads mean clips.

- **Instrument sub-mode**: scale-aware 8×4 layout (in-key default, chromatic option;
  root/scale configurable via Shift+Step 9 menu). +/– octave via Up/Down or dedicated
  gesture; Shift = shift by scale degree. Root notes highlighted, in-scale dim, out off.
- **Drum sub-mode**: auto-selected when cursor track has a Drum Machine
  (`cursorDevice.hasDrumPads()` / `createDrumPadBank(32)`); 32 pads = 32 drum cells with
  pad colors, mute/solo overlays, +/– moves the 16-pad window.
- **Step sequencer** on the 16 step buttons against the launcher cursor clip
  (`host.createLauncherCursorClip(16, 128)`):
  - step press toggles note at cursor key(s) (`clip.toggleStep`)
  - playing-position LED chase (`clip.playingStep()`)
  - held step + knobs = per-step velocity / length / (later) micro-shift via NoteStep API
  - held step + Left/Right = nudge, +/– = transpose
  - Loop button: loop-length editing on steps (bars), wheel = loop length
  - page navigation Left/Right when clip longer than 16 steps
- **Record**: Rec in Note mode = launcher record into selected slot; velocity pads feed the
  NoteInput so recording "just works" via Bitwig's normal path.

### 5.6 Display (OLED)

Current: 4 text lines — track / device / touched-param name / value.

Planned layout upgrades (needs protocol extension, §2.2):

- header: mode + bank window position (e.g. `SESSION 1-8 / sc 1-4`)
- param screen: 8 mini value bars matching knob positions
- volume/meter screen while Volume knob touched (master or held track)
- step-edit screen: step index, note(s), velocity, length
- transient "toast" line for actions (e.g. "Track 3 armed", auto-clears after ~1 s)
- tempo + play position + time sig on a status screen (Shift held)

### 5.7 Shift+Step settings menus (manual parity)

| Shift+Step | Move Control Live | Bitwig equivalent |
| --- | --- | --- |
| 3 | workflow settings | launcher post-rec action / default quantize (`application` / settings) |
| 5 | tempo | `transport.tempo()`, wheel edits |
| 6 | metronome | `transport.isMetronomeEnabled()` |
| 7 | groove | `host.createGroove().getShuffleAmount()` |
| 9 | key & scale | script-local scale state (feeds pad layout + highlights) |
| 10 | full velocity | script-local velocity override (translation table / velocity curve) |
| 11 | repeat rate | note-repeat (script-side, or skip in v1) |
| 14 | prepare next clip slot | `slot.select()` + `track.createNewLauncherClip()` |
| 15 | double loop | `clip.duplicateContent()` + double loop length |
| 16 | quantize clip | `clip.quantize(1.0)` |

## 6. Module (Move-side) Spec

- `module.json`: id `move-bitwig`, overtake, `claims_master_knob`, `raw_midi`,
  `api_version: 1` (UI-only modules use 1; `api_version: 2` is the *DSP plugin* API and
  irrelevant here — schwung's own `controller` overtake module ships 1).
- Lifecycle: `init()` (progressive LED clear, 8 writes/tick), `tick()` (drain TX queue,
  link watchdog, redraw), `onUnload()` (drop queue; host restores Move's LEDs).
- Connection watchdog: "Waiting for Bitwig…" until protocol traffic arrives; LEDs
  cleared and screen reverts 4 s after traffic stops.
- Consider later: `suspend_keeps_js` so Back can temporarily return to Move while the
  Bitwig link stays alive, and `button_passthrough` for controls Move should keep.

## 7. Constraints & Open Questions

- **RGB sysex (`3B 10`) needs on-hardware verification** — format is lifted from
  schwung's LED-restore cache of Move's own firmware traffic, so it should be exact, but
  pads vs. buttons idx handling (esp. the 16–31 overlap) and whether a note-on palette
  write afterwards overrides the RGB state are untested. Fallback: `LED_NOTE`/`LED_CC`
  palette commands + `nearestColor()` (still in `MoveHardware.js`).
- **Back button (CC 51)**: forwarded by the module, but the shim/shadow-UI may act on it
  first during overtake (suspend). Test; if Bitwig should own it, evaluate `raw_ui` or
  `button_passthrough` implications.
- **Capture MIDI** does not exist in the Bitwig API — Capture button needs a different job.
- **Slicing sub-mode** (Simpler-specific) has no clean Bitwig analog — out of scope.
- **Aftertouch** is currently filtered module-side; Note mode will want poly AT → NoteInput.
- **LED_RGB for step buttons** blocked on the idx 16–31 ambiguity above; steps use
  palette colors via `LED_NOTE`.
