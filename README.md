# Bitwig Studio Move Controller

A complete integration script and module to turn the Ableton Move into a dedicated, deeply-integrated MIDI controller for Bitwig Studio.

## Architecture
This project consists of two parts:
1. `move-bitwig` (Move Overtake Module): Runs on the Ableton Move hardware via the `schwung` runtime, acting as a thin client to parse Bitwig SysEx messages into screen updates and sending raw hardware outputs.
2. `Move.control.js` (Bitwig Control Surface Script): Runs inside Bitwig Studio connecting to the Move, managing the Clip Launcher, Device controls, and LED feedback.

## Current Setup & Controls (Phase 1)

### Transport & Navigation
| Control | Bitwig Action |
|---------|---------------|
| **Play** | Toggle Play |
| **Rec** | Toggle Arranger Record |
| **Up/Down** | Navigate Scene Bank |
| **Left/Right** | Navigate Track Bank |
| **Shift + Left/Right** | Navigate Devices |

### Device Remote Controls
| Control | Bitwig Action |
|---------|---------------|
| **Knobs 1-8 (Turn)** | Adjust current device macro / remote pages |
| **Knobs 1-8 (Touch)** | Show parameter name and value on the OLED |

### Pad Grid (Clip Launcher)
| Control | Bitwig Action |
|---------|---------------|
| **32 Main Pads** | 8x4 Clip Launcher Grid |
| **Pad Colors** | Grey = Has Clip, Green = Playing, Red = Recording |
| **Press** | Launch, Stop, or Record Clip |

## Expected Future Mapping (In Development)
- **Menu System**: `Shift + Menu` to mute internal audio, adjust pad velocity, and edit preferences directly on the Move OLED.
- **Instrument Modes**: Using the 16 step buttons to shift the 32 pads into a Note grid (isomorphic layout) and Drum Rack.
- **Step Sequencer**: Full Bitwig clip step sequencing via the 16 step buttons.

## Installation
1. Move the `Bitwig-Move/Move.control.js` file into your Bitwig Studio controller scripts directory (`Documents/Bitwig Studio/Controller Scripts/Move`).
2. Run `./scripts/install.sh` to package and push the `move-bitwig` module into your `schwung` overtake folder on your Ableton Move.
3. Start Bitwig Studio, go to Settings > Controllers, add "Ableton Move", and select the generic Ableton Move USB ports.
4. On the Move, jump into Shadow Mode (`Shift + Vol + Knob 1`), load "Overtake Modules", and select "Bitwig Move Controller".
