# Bitwig Studio Move Controller

A complete integration script and module to turn the **Ableton Move** into a dedicated, deeply-integrated MIDI controller for Bitwig Studio.

See **SPEC.md** for the full feature specification and **TODO.md** for the backlog.

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

## Current Status: v0.3 — modes + manual parity batch, **pending hardware test**

See the hardware test checklist in TODO.md.

## Control Reference

Two modes, toggled with **Menu** (Menu LED lit = NOTE mode):

- **SESSION** — pads launch clips, step buttons select/stop tracks
- **NOTE** — pads play the selected track (instrument or drum layout), step buttons
  are a 16-step sequencer on the selected clip

### Transport & Global
| Control          | Action                  | LED               |
| :--------------- | :---------------------- | :---------------- |
| **PLAY**         | Toggle Play / Stop      | Green = playing   |
| **Shift + PLAY** | Re-trigger playback     |                   |
| **REC**          | Toggle Arranger Record  | Red = recording   |
| **Shift + REC**  | Toggle Launcher Overdub |                   |
| **UNDO**         | Undo                    |                   |
| **Shift + UNDO** | Redo                    |                   |
| **MENU**         | Toggle SESSION / NOTE   | Lit = NOTE        |
| **CAPTURE**      | Tap tempo               |                   |
| **Shift + Wheel**| Tempo (1 BPM / detent)  |                   |

### Shift + Step actions
| Combo               | Action                            |
| :------------------ | :-------------------------------- |
| **Shift + Step 6**  | Toggle metronome                  |
| **Shift + Step 10** | Toggle full velocity              |
| **Shift + Step 15** | Double clip content               |
| **Shift + Step 16** | Quantize clip (100%)              |

### Track Buttons 1-4 (bank tracks 1-4)
| Control              | Action                     | LED                                        |
| :------------------- | :------------------------- | :----------------------------------------- |
| **Press**            | Select track               | White = selected, red = armed, else color  |
| **Press twice**      | Toggle record arm          |                                            |
| **Shift + Track**    | Launch scene 1-4           |                                            |
| **Mute + Track**     | Mute/unmute that track     |                                            |
| **Delete + Track**   | Delete track               |                                            |
| **Copy + Track**     | Duplicate track            |                                            |
| **Hold + Vol knob**  | That track's volume        |                                            |

### Mute & Misc (selected track)
| Control              | Action                        | LED                |
| :------------------- | :---------------------------- | :----------------- |
| **MUTE (tap)**       | Toggle Mute                   | Lit = muted/soloed |
| **Shift + MUTE tap** | Toggle Solo                   |                    |
| **MUTE (hold)**      | Modifier for other gestures   |                    |
| **Sample button**    | Toggle Record Arm             | Red ring = armed   |
| **Master Knob**      | Master volume (Shift = fine)  |                    |

### SESSION mode — pads & steps
| Control               | Action                                    | LED                                              |
| :-------------------- | :---------------------------------------- | :----------------------------------------------- |
| **Pad**               | Launch clip (record if empty + armed)     | Clip color; dim = stopped, blink = queued        |
| **Shift + Pad**       | Select clip slot                          |                                                  |
| **Delete + Pad**      | Delete clip                               |                                                  |
| **Steps 1,3,…,15**    | Select track 1-8                          | Track color, white = selected                    |
| **Steps 2,4,…,14**    | Stop clip in track 1-7                    | Dim white                                        |
| **Step 16**           | Stop all clips                            | Dim red                                          |

### NOTE mode — pads & steps
| Control            | Action                                              |
| :----------------- | :-------------------------------------------------- |
| **Pads**           | Play notes: in-key layout, root pads = track color; |
|                    | drum layout (auto with a Drum Machine) = pad colors |
| **Up / Down**      | Octave ±1 (drum: pad window ±16, Shift = ±4)        |
| **Steps 1-16**     | Tap: toggle step for the last played note           |
| **Step held + Vol**| Velocity of all notes in that step                  |
| **Step held + Wheel** | Note length (Shift = fine, 1/64)                 |
| **Left / Right**   | Step-sequencer page                                 |
| Step LEDs          | White = has notes, green = playhead                 |

### Navigation
| Control            | Action                                      |
| :----------------- | :------------------------------------------ |
| **Left / Right**   | Scroll track bank (SESSION)                 |
| **Up / Down**      | Scroll scene bank (SESSION)                 |
| **Shift + U / D**  | Scroll scenes by page                       |
| **Shift + L / R**  | Previous / next Remote Controls page        |
| **Jog Wheel**      | Select previous / next device               |
| **Jog Click**      | Fold / unfold device                        |
| **Mute + Click**   | Toggle device on/off                        |

### Device & Parameters
| Control                 | Action                         | Feedback                     |
| :---------------------- | :----------------------------- | :--------------------------- |
| **Knobs 1-8**           | Remote Controls (Shift = fine) | Value on OLED + ring LED     |
| **Knob Touch**          | Focus parameter                | Name & value on OLED         |
| **Delete + Knob Touch** | Reset parameter                |                              |
| **Master Knob Touch**   | Focus master volume            | Name & value                 |

## Installation

### 1. Hardware Setup (Ableton Move)
1. Ensure your Move has the `schwung` runtime installed.
2. Deploy the module:
   ```bash
   ./scripts/build.sh && ./scripts/install.sh
   ```
3. On the Move: enter Shadow Mode (`Shift + Vol + Knob 1`), go to the Tools /
   Overtake menu, and select **Bitwig Move Controller**.

### 2. Software Setup (Bitwig Studio)
1. Copy the contents of `Controller Scripts/` to your Bitwig Controller Scripts folder:
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


