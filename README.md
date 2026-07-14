# Move Bitwig

<p align="center">
  <img src="assets/movebitwig.svg" alt="Move Bitwig logo" width="480">
</p>

A complete integration script and module to turn the **Ableton Move** into a dedicated, deeply-integrated MIDI controller for Bitwig Studio.

## Architecture

1. **Move module (`move-bitwig`)**: a JavaScript overtake module running on the Move via
   [schwung](https://github.com/charlesvestal/schwung). Owns the OLED and LEDs, forwards
   hardware input to Bitwig, renders feedback received over sysex.
2. **Bitwig Controller Script (`Move.control.js`)**: the driver running in Bitwig Studio.
   Owns all state and observers, speaks **protocol v2** (sysex) to the module.

### Protocol v2 (sysex)

All Bitwig → Move feedback (display text, LEDs) travels as sysex
(`F0 7D 4D 42 <cmd> ... F7`); all Move → Bitwig input stays plain notes/CCs. Because
feedback and input never share message types, **LED feedback loops are impossible** —
the old virtual-CC bridge, text-over-CC protocol and echo filters are gone.

Pad and step LEDs use Move's 128-color palette (nearest-match to Bitwig colors); the
track-button row, Sample ring and knob rings get **direct RGB** via Move's native
Ableton LED sysex (`F0 00 21 1D 01 01 3B 10 <idx> <rgb…> F7`).

The link is supervised: Bitwig pings every second; the module shows
"Waiting for Bitwig…" and clears LEDs when the link drops, and full state is resent on
reconnect.

## Current Status: v0.6 — first public release (beta)

Hardware-tested on a real Move. Expect rough edges — bug reports welcome.
Known area that still needs work: the step sequencer (see TODO.md).

## Control Reference

Three modes, cycled with **Menu** (Menu LED: off = SESSION, bright = NOTE, dim = MIXER):

- **SESSION** — pads launch clips, step buttons select/stop tracks
- **NOTE** — pads play the selected track (instrument or drum layout), step buttons
  are a 16-step sequencer on the selected clip
- **MIXER** — knobs = 8 track volumes, pad rows = arm / solo / mute / select

**Shift + Menu** opens the **Session Overview** (each pad = an 8×4 block of the project;
pressing one jumps the window there).

### Transport & Global
| Control             | Action                                        | LED                    |
| :------------------ | :-------------------------------------------- | :--------------------- |
| **PLAY**            | Toggle Play / Stop                            | Green = playing        |
| **Shift + PLAY**    | Re-trigger playback                           |                        |
| **REC**             | Arranger record (NOTE mode: launcher overdub) | Red = active           |
| **Shift + REC**     | The other record target                       |                        |
| **UNDO**            | Undo                                          |                        |
| **Shift + UNDO**    | Redo                                          |                        |
| **MENU**            | Cycle SESSION / NOTE / MIXER                  | Bright=NOTE, dim=MIXER |
| **Shift + MENU**    | Session Overview on/off                       |                        |
| **LOOP (tap)**      | Toggle arranger loop                          | Lit = loop on          |
| **LOOP (hold)**     | Loop Mode (NOTE mode, see below)              |                        |
| **CAPTURE**         | Tap tempo                                     |                        |
| **Shift + CAPTURE** | Add device (opens browser)                    |                        |
| **Shift + Wheel**   | Tempo (1 BPM / detent)                        |                        |

### Shift + Step actions
While Shift is held the **icon LEDs below the steps** show the map: dim
white = has a function, green = that toggle is on.

| Combo               | Action                             |
| :------------------ | :--------------------------------- |
| **Shift + Step 3**  | Cycle quantize amount (100/50/75%) |
| **Shift + Step 6**  | Toggle metronome                   |
| **Shift + Step 7**  | Toggle global groove               |
| **Shift + Step 9**  | Key & Scale overlay (NOTE mode)    |
| **Shift + Step 10** | Toggle full velocity               |
| **Shift + Step 15** | Double clip content                |
| **Shift + Step 16** | Quantize clip (set amount)         |

### Track Buttons 1-4 (bank tracks 1-4)
| Control             | Action                 | LED                                       |
| :------------------ | :--------------------- | :---------------------------------------- |
| **Press**           | Select track           | White = selected, red = armed, else color |
| **Press twice**     | Toggle record arm      |                                           |
| **Shift + Track**   | Launch scene 1-4       |                                           |
| **Mute + Track**    | Mute/unmute that track |                                           |
| **Delete + Track**  | Delete track           |                                           |
| **Copy + Track**    | Duplicate track        |                                           |
| **Hold + Vol knob** | That track's volume    |                                           |

### Mute & Misc (selected track)
| Control              | Action                       | LED                |
| :------------------- | :--------------------------- | :----------------- |
| **MUTE (tap)**       | Toggle Mute                  | Lit = muted/soloed |
| **Shift + MUTE tap** | Toggle Solo                  |                    |
| **MUTE (hold)**      | Modifier for other gestures  |                    |
| **Sample button**    | Toggle Record Arm            | Red ring = armed   |
| **Master Knob**      | Master volume (Shift = fine) |                    |

### SESSION mode — pads & steps
| Control             | Action                                | LED                                       |
| :------------------ | :------------------------------------ | :---------------------------------------- |
| **Pad**             | Launch clip (record if empty + armed) | Clip color; dim = stopped, blink = queued |
| **Shift + Pad**     | Select clip slot                      |                                           |
| **Delete + Pad**    | Delete clip                           |                                           |
| **Copy + Pad, Pad** | Copy clip from first to second pad    |                                           |
| **Steps 1,3,…,15**  | Select track 1-8                      | Track color, white = selected             |
| **Steps 2,4,…,14**  | Stop clip in track 1-7                | Dim white                                 |
| **Step 16**         | Stop all clips                        | Dim red                                   |

In **Session Overview** (Shift+Menu): pads = 8×4 blocks, white = current window,
dim = inside the project; pressing a pad jumps there and returns to SESSION.

In SESSION and MIXER the display's second line shows the window position
(`Trk 1-8  Scn 1-4`).

### NOTE mode — pads & steps
| Control               | Action                                                           |
| :-------------------- | :--------------------------------------------------------------- |
| **Pads**              | Play notes: in-key layout, root pads = track color;              |
|                       | Sounding pads light green                                        |
| **Up / Down**         | Octave ±1 (toast shows octave; drum: pad window ±16, Shift = ±4) |
| **Shift + U / D**     | Shift in-key layout ±1 scale degree                              |
| **Steps 1-16**        | Tap: XO-toggle the selected note (last played pad)               |
| **Pads held + Step**  | Write the held chord into that step                              |
| **Step held + Pads**  | Play pads to write them into the held step                       |
| **Step held + Vol**   | Velocity of all notes in that step                               |
| **Step held + Wheel** | Note length (Shift = fine, 1/64)                                 |
| **Step held + L / R** | Nudge notes one step left / right                                |
| **Step held + U / D** | Transpose ±1 semitone (Shift = ±12)                              |
| **Left / Right**      | Step-sequencer page                                              |
| Step LEDs             | White = selected note on that step, dim = other                  |
|                       | notes, green = playhead (Move-style: press a pad to              |
|                       | see and edit *its* sequence)                                     |

#### Loop Mode (hold Loop)
While Loop is held, each step button = one bar; step LEDs show the clip loop
in white (Move-style).

| Control                   | Action                            |
| :------------------------ | :-------------------------------- |
| **Tap step n**            | Loop bars 1..n                    |
| **Double-tap step n**     | Loop just bar n                   |
| **Hold step A + press B** | Loop bars A..B                    |
| **Loop + Up / Down**      | Double / halve the loop length    |
| **Loop + Copy**           | Double the clip content           |
| **Loop + Wheel**          | Loop length ±1 bar (Shift = 1/16) |

#### Drum layout (auto with a Drum Machine)
The **left 4×4** plays the drum pads (bottom-left = lowest, pad colors from
the rack). The **right 4×4** is 16 fixed velocity levels for the last played
pad (bottom-left = soft, top-right = full; current level lit green) — taps
also write into a held step, and step taps use the chosen velocity.

**Shift + Pad** selects the drum pad (name on OLED, step row follows),
**Mute + Pad** mutes/unmutes it (muted pads are dimmed), **held Pad +
Volume encoder** adjusts that pad's chain volume. Up/Down moves the 16-pad
window (toast shows the range). Pressing a pad shows its sequence in the
step row for XO editing.

#### Key & Scale overlay (Shift + Step 9)
| Control          | Action                                   |
| :--------------- | :--------------------------------------- |
| **Jog Wheel**    | Root note (C, C#, … B)                   |
| **Up / Down**    | Octave ±1                                |
| **Left / Right** | Scale (Major, Minor, Dorian, … 10 total) |
| **Jog Click**    | Toggle In-Key / Chromatic layout         |
| **Back**         | Close overlay (or Shift+Step 9 again)    |

Pads keep playing while the overlay is open, so changes can be auditioned.
Chromatic layout = rows of fourths; LEDs: root = track color, in-scale = dim
white, out-of-scale = off.

### MIXER mode
| Control             | Action                                     | LED                   |
| :------------------ | :----------------------------------------- | :-------------------- |
| **Knobs 1-8**       | Track 1-8 volume (Shift = fine)            | Ring = color × volume |
| **Mute + Knob**     | Track pan (Shift = fine)                   |                       |
| **Copy + Knob**     | Send A (Copy + Shift + Knob = Send B)      |                       |
| **Pad row 1 (top)** | Toggle record arm                          | Red = armed           |
| **Pad row 2**       | Toggle solo                                | Yellow = soloed       |
| **Pad row 3**       | Toggle mute                                | Orange = muted        |
| **Pad row 4 (bot)** | Select track                               | White = selected      |
| **Steps**           | Same as SESSION (select / stop / stop all) |                       |
| **Knob touch**      | Show that track's volume on the display    |                       |

### Navigation
| Control             | Action                                       |
| :------------------ | :------------------------------------------- |
| **Left / Right**    | Scroll track bank (SESSION)                  |
| **Up / Down**       | Scroll scene bank (SESSION)                  |
| **Shift + U / D**   | Scroll scenes by page                        |
| **Shift + L / R**   | Previous / next Remote Controls page         |
| **Jog Wheel**       | Select previous / next device                |
| **Jog Click**       | Fold / unfold device                         |
| **Mute + Click**    | Toggle device on/off                         |
| **Shift + Click**   | Replace current device (opens browser)       |
| **Delete + Click**  | Delete current device                        |
| **Shift + Capture** | Add a device after the current one (browser) |

### Device & Parameters
| Control                 | Action                         | Feedback                                             |
| :---------------------- | :----------------------------- | :--------------------------------------------------- |
| **Knobs 1-8**           | Remote Controls (Shift = fine) | Name + value on OLED, ring LED                       |
| **Knob Touch**          | Focus parameter                | Its name & value while touched (rings show the rest) |
| **Delete + Knob Touch** | Reset parameter                |                                                      |
| **Master Knob Touch**   | Focus master volume            | Name & value                                         |

### Device Browser (Shift+Capture = add, Shift+Jog Click = replace)
While the Bitwig popup browser is open, the display shows the current tab
and selection:

| Control       | Action                                 |
| :------------ | :------------------------------------- |
| **Jog Wheel** | Previous / next result                 |
| **Up / Down** | Content-type tab (Devices, Presets, …) |
| **Jog Click** | Load the selection                     |
| **Back**      | Cancel                                 |

## Installation

Grab both assets from the [latest release](https://github.com/pi43r/move-bitwig/releases/latest):
`move-bitwig-module.tar.gz` (for the Move) and
`move-bitwig-controller-scripts.zip` (for Bitwig) — or build from source as
described below.

### 1. Hardware Setup (Ableton Move)
1. Ensure your Move has the `schwung` runtime installed.
2. Deploy the module — either install the release tarball via
   schwung-manager, or from a checkout:
   ```bash
   ./scripts/build.sh && ./scripts/install.sh
   ```
3. On the Move: enter Shadow Mode (`Shift + Vol + Knob 1`), go to the Tools /
   Overtake menu, and select **Move Bitwig**.

### 2. Software Setup (Bitwig Studio)
1. Unzip `move-bitwig-controller-scripts.zip` (or copy the contents of
   `Controller Scripts/`) into your Bitwig Controller Scripts folder:
   - **Windows**: `%USERPROFILE%\Documents\Bitwig Studio\Controller Scripts\Move\`
   - **macOS**: `~/Documents/Bitwig Studio/Controller Scripts/Move/`

   > Upgrading from v0.1? Delete the old folder first — `MoveDisplay.js` no longer exists.
2. In Bitwig: **Settings > Controllers > Add Controller > Ableton > Move**.
3. Select the **Ableton Move** USB MIDI ports for Input and Output.
4. The Bitwig console should print `MoveProtocol: handshake ok`.

## Debugging

- Bitwig side: open the controller console (Settings > Controllers > Move > console icon).
- Move side:
  ```bash
  ssh ableton@move.local "touch /data/UserData/schwung/debug_log_on"
  ssh ableton@move.local "tail -f /data/UserData/schwung/debug.log"
  ```
  Module errors are logged with a `move-bitwig` prefix via `console.log`.


## Disclaimer

Move Bitwig is not associated with either the Ableton AG or Bitwig GmbH. I made it in my free time and you can use and modify it however you wish.
Most of the code was generated using AI coding agents (Claude mainly), I tested manually and looked through some of the code.

Thanks to DrivenByMoss for tutorials and code on scripting Bitwig.

If something is broken or you have feature requests, open an [Issue](https://github.com/pi43r/move-bitwig/issues) on github or ask in the Schwung [discord](https://discord.gg/GHWaZCC9bQ).
Pull Requests are welcome!