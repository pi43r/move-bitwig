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

Pad and RGB-button colors are sent as **direct RGB** and re-emitted by the module using
Move's native Ableton LED sysex (`F0 00 21 1D 01 01 3B 10 <idx> <rgb…> F7`) — colors
match Bitwig exactly, no 128-color palette matching.

The link is supervised: Bitwig pings every second; the module shows
"Waiting for Bitwig…" and clears LEDs when the link drops, and full state is resent on
reconnect.

## Current Status: protocol v2 rework — **pending hardware test**

See the hardware test checklist at the top of TODO.md.

## Control Reference

### Transport & Global
| Control          | Action                  | LED             |
| :--------------- | :---------------------- | :-------------- |
| **PLAY**         | Toggle Play / Stop      | Lit = playing   |
| **Shift + PLAY** | Re-trigger playback     |                 |
| **REC**          | Toggle Arranger Record  | Lit = recording |
| **Shift + REC**  | Toggle Launcher Overdub |                 |
| **UNDO**         | Undo                    |                 |
| **Shift + UNDO** | Redo                    |                 |

### Track Controls (Selected Track)
| Control           | Action                       | LED                |
| :---------------- | :--------------------------- | :----------------- |
| **MUTE**          | Toggle Mute                  | Lit = muted/soloed |
| **Shift + MUTE**  | Toggle Solo                  |                    |
| **Sample button** | Toggle Record Arm            | Red ring = armed   |
| **Master Knob**   | Master volume (Shift = fine) |                    |

### Clip Launcher & Scenes
| Control               | Action           | LED                                                                |
| :-------------------- | :--------------- | :----------------------------------------------------------------- |
| **Pads (8x4)**        | Launch clips     | Clip color (RGB); dim = stopped, bright = playing, red = recording |
| **Shift + Pad**       | Select clip slot |                                                                    |
| **Delete + Pad**      | Delete clip      |                                                                    |
| **Track buttons 1-4** | Launch Scene 1-4 | Scene color (RGB)                                                  |

### Navigation
| Control           | Action                        |
| :---------------- | :---------------------------- |
| **Left / Right**  | Scroll track bank (8 tracks)  |
| **Up / Down**     | Scroll scene bank (4 scenes)  |
| **Shift + L / R** | Select previous / next device |
| **Jog Wheel**     | Select track                  |

### Device & Parameters
| Control               | Action                         | Display         |
| :-------------------- | :----------------------------- | :-------------- |
| **Knobs 1-8**         | Remote Controls (Shift = fine) | Parameter value |
| **Knob Touch**        | Focus parameter                | Name & value    |
| **Master Knob Touch** | Focus master volume            | Name & value    |

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


