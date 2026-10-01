# Move Bitwig

<p align="center">
  <img src="assets/movebitwig.svg" alt="Move Bitwig logo" width="480">
</p>

Turn **Ableton Move** into a groovebox for **Bitwig Studio**: choose a sound, play pads, build a sequence, and launch your song.

- **Session:** launch clips and select tracks.
- **Note:** play melodic or drum pads and edit a 16-step sequence.
- **Mixer:** adjust tracks, FX returns, and Main with Shift + Menu.

## Set up

You need **Bitwig Studio 6**, an Ableton Move with [Schwung](https://github.com/charlesvestal/schwung) installed, and a USB-C data connection from Move to your computer.

1. Download **both files** from the [latest release](https://github.com/pi43r/move-bitwig/releases/latest):
   - `move-bitwig-module.tar.gz` for Move.
   - [`move-bitwig-controller-scripts.zip`](https://github.com/pi43r/move-bitwig/releases/latest/download/move-bitwig-controller-scripts.zip) for Bitwig on your computer. Installing the Schwung module alone is not enough.
2. Install the module using Schwung Manager. Open Schwung on Move and choose **Move Bitwig** from its takeover modules. For source installation, see [Development](docs/DEVELOPMENT.md).
3. Extract all controller scripts into a folder called `Move` inside your Bitwig Controller Scripts folder:

   | System | Folder |
   | --- | --- |
   | Windows | `%USERPROFILE%\Documents\Bitwig Studio\Controller Scripts\Move\` |
   | macOS | `~/Documents/Bitwig Studio/Controller Scripts/Move/` |
   | Linux | `~/Bitwig Studio/Controller Scripts/Move/` |

4. In Bitwig, open **Settings → Controllers → Add Controller → Ableton → Move**.
5. Choose **Ableton Move (Standalone Port)** for both MIDI input and output when listed. Some systems list the port as **Ableton Move**. Use matching input/output ports; the Live, User, and External ports serve other purposes.
6. Move's screen should show the selected track when the connection is ready.

Install the module and controller scripts from the same release. On Move, setup and control help is available under **Schwung → Global Settings → System → Help → Modules → Move Bitwig**.

### macOS: Standalone Port is missing

macOS can keep an outdated MIDI device entry after Move's firmware changes its ports. [Ableton documents this issue and the fix](https://help.ableton.com/hc/en-us/articles/14661164865308-Using-MIDI-with-Move):

1. Disconnect Move from your Mac.
2. Open **Audio MIDI Setup → MIDI Studio** (Window → Show MIDI Studio).
3. Select and remove the existing **Ableton Move** device entry.
4. Reconnect Move, then select **Ableton Move (Standalone Port)** in Bitwig for input and output.

This refreshes the Mac's device entry; you do not need to delete your controller scripts.

### Windows: duplicate Move ports after reconnecting

If reconnecting USB produces a second set of `Ableton Move MIDI #2` ports and Bitwig cannot open them, try this:

1. Close Bitwig and other applications using MIDI, including standalone plug-ins.
2. Disconnect USB, restart Move, and reconnect it before opening Bitwig.
3. In Bitwig's controller settings, keep one Move controller entry for one physical Move and select a matching input/output pair. Avoid assigning the same ports to multiple controller entries.

A reported Windows setup lists numbered names such as `MIDIIN4 (Ableton Move MIDI)` and `MIDIOUT4 (Ableton Move MIDI)`. Port labels depend on the driver; a `#2` suffix alone does not tell you which instance is usable. Confirm the mapping by waiting for Move's connected screen.

The duplicate-port log does not establish a cause. A Move restart has cleared it on the reported setup. Windows can also leave MIDI ports unavailable when it believes another application owns them; see [Ableton's Windows MIDI troubleshooting](https://help.ableton.com/hc/en-us/articles/209069929-Red-MIDI-ports-Windows). The controller script cannot remove Windows device entries or reopen ports that Bitwig failed to open. If it recurs, include your Windows build, Bitwig/Schwung/Move versions, and whether restarting Bitwig alone clears it in an issue report.

## Your first minute

1. Press **Shift + Step 1** to add an instrument track. Turn the wheel to choose a sound and click to load it. **Shift + Step 2** adds an audio track. Unused pad columns stay dark and do nothing.
2. In **Note**, play a pad, then tap bottom-row steps. The first step creates a clip if needed, using Bitwig's default length.
3. Press **Menu** for Session and launch the clip. Menu returns to Note for editing.
4. Use the four left track keys in Note to change instruments. The sequencer always follows the selected track.
5. Use **Left / Right** to move through a phrase; navigation stays inside its loop. In drum mode, the left 16 pads play drums. Hold a right-hand modifier pad, turn the wheel, and press a step to apply velocity, chance, repeat, pan, or another expression.

| Control | Start here |
| --- | --- |
| Play / Record | Playback / recording |
| Menu | Session ↔ Note; Shift + Menu opens Mixer |
| Track buttons | Select the four visible tracks in Note; Session uses bottom-row select buttons |
| Knobs 1–8 | Device parameters; track volumes in Mixer |
| Volume encoder | Main volume or optional last-touched parameter; hold a track button for its volume |
| Shift + Step 1 / 2 | New instrument / audio track |
| Shift + Step 3 | Workflow: quantize, step grid, automation writing |
| Shift + Step 5 | Tempo |
| Capture + wheel click | Browse presets of the focused device; add Shift to insert FX |
| Undo / Shift + Undo | Undo / redo |

See the **[control guide](docs/CONTROLS.md)** for the pad layouts, step editing, drums, browsing, and every shortcut.

## If it does not connect

- **Waiting for Bitwig:** check that the Move Bitwig module is open, the controller is enabled, and both MIDI ports use the Standalone Port. On macOS, try the recovery steps above.
- **Controller not listed:** copy every `.js` file from the controller download into the same `Move` folder, then restart Bitwig.
- **Still stuck:** open an [issue](https://github.com/pi43r/move-bitwig/issues) with your OS, Move firmware, Schwung and Bitwig versions, MIDI port names, and the steps that reproduce the problem. Logs and source-build instructions are in [Development](docs/DEVELOPMENT.md).

## Credits and project information

Move Bitwig is not associated with Ableton AG or Bitwig GmbH. I made it in my free time and you can use and modify it however you wish.
Most of the code was generated using AI coding agents; I tested manually and looked through some of the code.

Thanks to DrivenByMoss for tutorials and code on scripting Bitwig.

If something is broken or you have feature requests, open an [issue](https://github.com/pi43r/move-bitwig/issues) or ask in the Schwung [Discord](https://discord.gg/GHWaZCC9bQ).

Pull requests are welcome!
