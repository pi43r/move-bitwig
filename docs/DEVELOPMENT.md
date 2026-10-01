# Development

The Bitwig controller uses API 25. The Move module runs in Schwung's QuickJS takeover host. No package installation is needed: checks use Node.js 22, and packaging uses Python 3. On Windows, use `python` where the commands below say `python3`.

## Check and build

From the repository root:

```sh
node --test tests/*.test.cjs
python3 scripts/build.py
```

The build produces both installable archives:

- `dist/move-bitwig-module.tar.gz`: `move-bitwig/module.json`, `move-bitwig/ui.js`, and `move-bitwig/help.json`.
- `dist/move-bitwig-controller-scripts.zip`: the entry point and every script it loads, at the archive root.

The builder checks the module version, controller version, and release URL. It follows the controller's `load()` calls, excludes editor declarations and unrelated files, and uses fixed archive timestamps. `bash scripts/build.sh` runs the same builder.

Install the module with Schwung Manager, or run `bash scripts/install.sh` to send the built archive over SSH to `ableton@move.local`. The script extracts into `/data/UserData/schwung/modules/overtake/`. Reopen Move Bitwig afterward. Extract the controller ZIP into the folder listed in the [setup guide](../README.md#set-up).

## Code ownership

| File | Responsibility |
| --- | --- |
| `Move.control.js` | Initialization, input routing, mode changes, flush |
| `MoveHardware.js` | Hardware addresses, pad coordinates, colors |
| `MoveNavigation.js` | Shared track/device banks, parameters, volume, navigation |
| `MoveLastTouched.js` | GUI parameter tracking and a persistent pinned Volume target |
| `MoveGrid.js`, `MoveSceneStop.js` | Session clips/scenes and scene-wide stop |
| `MoveNotes.js` | Playable layouts, held gestures, note editing, note LEDs |
| `MoveDrumMods.js` | Sixteen drum expression modifiers |
| `MoveSequencer.js` | Clip identity, page boundaries, grid, bar overview |
| `MoveTrackControls.js`, `MoveTransport.js`, `MoveMixer.js` | Track, transport, and mixer controls |
| `MoveWorkflow.js` | Settings screens, Shift shortcuts, shortcut LEDs |
| `MoveBrowser.js` | Device browsing and preset selection |
| `MoveFeedback.js`, `MoveScreen.js` | Bitwig focus/indications and Move screen content |
| `MoveProtocol.js` | Connection, cached feedback, SysEx output |
| `src/ui.js` | Move lifecycle, MIDI parsing, LED pacing, OLED rendering |

Keep controller code compatible with Bitwig's JavaScript loader. Keep the Move renderer inside `ui.js`: Schwung reloads that file on launch, while relative ES-module imports can remain cached for the life of `shadow_ui`. Shared Schwung constants and MIDI utilities are imported from the host installation.

## MIDI and display protocol

Bitwig sends feedback in SysEx frames: `F0 7D 4D 42 <command> <payload> F7`. Hardware input travels as notes and CCs. All payload bytes are seven-bit values.

| Command | Payload |
| --- | --- |
| `00` Ping / `40` Pong | Sequence number |
| `01` Text | Line 0–3 followed by ASCII characters |
| `02` Note LED / `03` CC LED | Address/color pairs |
| `04` RGB LED | Address/red/green/blue groups |
| `05` Clear | Empty |
| `07` Bar overview | Empty to hide, or seven values described below |
| `7E` Hello | Protocol version: 2 |
| `41` Hello acknowledgment | Version, optional capability bits |

Capability bit 0 enables the bar overview; bit 1 enables labels up to 48 characters (otherwise 24). Install matched controller/module releases. The overview contains `[bars, loopStart, loopEnd, playingBar + 1, pageStart, pageEnd, progress]`. Ranges are zero-based, end-exclusive four-beat blocks; playing value 0 means stopped; progress is 0–16. The first display line carries `KIND|track` for its icon and title. Screen record formatting lives in `MoveScreen.js` and `src/ui.js`.

Bitwig pings every second. Link timeout clears feedback, and the module announces readiness on launch so the controller resends its state. LED updates are coalesced by destination and paced within a 12-packet tick budget. Rendering is dirty-driven, with local animation for mode announcements, playback, and scrolling names.

## Schwung help

`src/help.json` provides on-device setup and control topics. Schwung discovers the file from the installed module directory under **Global Settings → System → Help → Modules → Move Bitwig**. Its root must have a non-empty `children` array. Topics use `title` and `lines`; keep text ASCII and at most 20 characters per line for the 128×64 display.

The setup topic directs users to the repository's Releases page for the controller ZIP. The Move module and the Bitwig scripts must come from the same release. Help is included in the module archive, so it can be tested locally before adding the module to Schwung's catalog.

## Diagnostics

Open Bitwig's controller console from Settings → Controllers. On Move:

```sh
ssh ableton@move.local "touch /data/UserData/schwung/debug_log_on"
ssh ableton@move.local "tail -f /data/UserData/schwung/debug.log"
```

For a bug report, include OS, Bitwig, Schwung and Move firmware versions; MIDI port names; the steps to reproduce; and relevant logs.

## Release

Set the same version in `src/module.json`, `release.json`, and `Move.control.js`; update the download URL in `release.json`. Edit [release copy](RELEASE.md), then run:

```sh
node --test tests/*.test.cjs
python3 scripts/build.py --tag v1.0.0
```

The maintainer has completed the v1 hardware checklist. Smoke-test the final packaged build before publishing. Pushing a version tag runs the checks and creates a GitHub **draft** release containing both archives. Review that draft before publishing. Local builds do not upload, tag, or install anything.
