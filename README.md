# Bitwig Studio Move Controller

A complete integration script and module to turn the **Ableton Move** into a dedicated, deeply-integrated MIDI controller for Bitwig Studio.

## Architecture
This project uses a "Middleman" architecture to bypass standard MIDI limitations and provide rich visual feedback:
1.  **Move Overtake Module (`move-bitwig`)**: A custom JavaScript module running on the Move (via `schwung`). It handles the OLED display via a custom **Text-over-CC** protocol and manages LED feedback loops.
2.  **Bitwig Control Surface Script (`Move.control.js`)**: The main driver running in Bitwig Studio. It manages state, observers, and sends high-level commands to the hardware.

## Current Project Status: **Phase 1 (Core Control)**
The controller is currently functional for transport, navigation, device control, and basic clip launching.

### Feature Checklist

#### ✅ Implemented
- **Infrastructure**
  - [x] Bidirectional MIDI communication bridge.
  - [x] **Middleman CC Bridge**: Custom virtual CCs (100-107) for LED feedback to terminate feedback loops.
  - [x] Custom Text-over-CC OLED protocol (4 lines of text).
  - [x] Color Engine: Match Bitwig colors to Move's 128-color hardware palette.
- **Transport & Global**
  - [x] Play / Pause toggle.
  - [x] Arranger Record toggle (**REC** button).
  - [x] Real-time LED feedback: Play (Green), Global Rec (Red).
- **Track Controls**
  - [x] **Mute / Solo**: Dedicated `MUTE` button toggles mute; `Shift + Mute` toggles Solo.
  - [x] **Record Arm**: **Sample** button (CC 118) toggles track arm with RGB LED feedback.
  - [x] **Stop Clip**: Hold `Shift + Pad` to stop the clip in that cell.
- **Navigation & Launcher**
  - [x] **Scene Launching**: Track Selector buttons 1-4 launch scenes 1-4.
  - [x] Track Bank scrolling (8 tracks at a time) via Left/Right arrows.
  - [x] Scene Bank scrolling (4 scenes at a time) via Up/Down arrows.
  - [x] Device Selection via `Shift + Left/Right`.
  - [x] 8x4 Grid (32 Pads) mapped to Bitwig Clip Launcher.
- **Device & Parameters**
  - [x] Automatic mapping of 8 Remote Controls to Move Knobs.
  - [x] **Capacitive Touch**: Touching a knob immediately focuses the parameter on the OLED.
  - [x] Real-time parameter name and value display.
  - [x] Master Volume control via the **Master Knob** (physical 9th knob).

#### 🏗️ In Progress / Planned
- [ ] **Navigation & Selection**: Use the **Jog Wheel** for scrolling through tracks/scenes and clicking to select.
- [ ] **Note Modes**: Isomorphic Piano layout and 4x4 Drum Rack mode.
- [ ] **Step Sequencer**: Full Bitwig step sequencing via the 16 step buttons.
- [ ] **Advanced UI**: Graphical meters (Peak/RMS) and Volume/Pan visualizers on OLED.
- [ ] **Menu System**: `Shift + Menu` for hardware settings (Velocity curve, MIDI channel).

## Control Reference

### Transport & Global
| Control | Action | LED Feedback |
| :--- | :--- | :--- |
| **PLAY** | Toggle Play / Pause | Green = Playing |
| **REC** | Toggle Arranger Record | Red = Recording |
| **Shift + Menu** | (Planned) Hardware Settings | |

### Track Controls (Selected Track)
| Control | Action | LED Feedback |
| :--- | :--- | :--- |
| **MUTE** | Toggle Mute | White = Muted / Soloed |
| **Shift + MUTE** | Toggle Solo | White = Muted / Soloed |
| **Sample** | Toggle Record Arm | Red = Armed |
| **Master Knob** | Master Volume | |

### Clip Launcher & Scenes
| Control | Action | LED Feedback |
| :--- | :--- | :--- |
| **Pads (8x4)** | Launch or Record Clips | RGB (Matches Bitwig) |
| **Shift + Pad** | Stop Clip in slot | |
| **Track Sel 1-4**| Launch Scene 1-4 | RGB (Matches Scene color) |

### Navigation
| Control | Action |
| :--- | :--- |
| **Left / Right** | Scroll Track Bank (8 tracks) |
| **Up / Down** | Scroll Scene Bank (4 scenes) |
| **Shift + L / R** | Select Previous / Next Device |
| **Jog Wheel** | (Planned) Scroll through tracks/scenes |

### Device & Parameters
| Control | Action | Display Feedback |
| :--- | :--- | :--- |
| **Knobs 1-8** | Adjust Remote Controls | Parameter Value |
| **Knob Touch** | Focus Parameter | Parameter Name & Value |

## Installation

### 1. Hardware Setup (Ableton Move)
1. Ensure your Move has the `schwung` runtime installed.
2. Run the deployment script to push the overtaker module:
   ```bash
   ./scripts/install.sh
   ```
3. On the Move: Enter **Shadow Mode** (`Shift + Volume + Knob 1`), go to **Overtake Modules**, and select **Bitwig Move Controller**.

### 2. Software Setup (Bitwig Studio)
1. Copy the contents of `Controller Scripts/` to your Bitwig Controller Scripts folder:
   - **Windows**: `%USERPROFILE%\Documents\Bitwig Studio\Controller Scripts\Move\`
   - **macOS**: `~/Documents/Bitwig Studio/Controller Scripts/Move/`
2. In Bitwig: Go to **Settings > Controllers**.
3. Click **Add Controller** > **Ableton** > **Move**.
4. Select the **Ableton Move** (USB MIDI) ports for both Input and Output.

## Technical Details
- **OLED Protocol**: Uses CC 110-113 for character data and CC 114 as a commit flag.
- **Color Engine**: Implements Euclidean distance matching against the official Move 128-color palette for accurate LED feedback.
- **Touch Logic**: Leverages Move's capacitive touch reports to provide "Sticky" parameter info on the display.
