# After v1

These are design candidates, not available controls. Keep the focus on making a song quickly from the hardware.

## Workflow and robustness

- Prepare the next empty recording slot without leaving Note.
- Make loop gestures and the overview follow the project's time signature.
- Add direct phrase-page selection and optional playhead follow that pauses during edits.
- Handle audio clips on hybrid tracks explicitly.
- Improve browser device matching and filter navigation where the API permits it.
- Keep step, loop, and held-note gesture ownership explicit as the note engine grows.
- Harden handshake sequencing and interrupted MIDI-frame recovery.

## Musical tools

- Step recording, page copy/paste, and selected-drum pattern fills.
- Note repeat, arpeggiation, latch, and chord entry.
- Humanize timing and note expressions with reversible edits.
- Favorite FX insertion and performance presets with useful remote pages.
- Cue-marker navigation and a focused session-to-arranger recording workflow.
- Remember scale, octave, and expression settings per project or track.

## API research

Use the installed Bitwig controller documentation and `Controller Scripts/bitwig-api.d.ts` to verify each design. Useful candidates include `NoteInput.arpeggiator()`, `noteLatch()`, `Parameter.modulatedValue()`, `RangedValue.discreteValueNames()`, `LastClickedParameter.isLocked()`, and cue-marker banks.

Project key synchronization, alias clips, sample slicing, modulator creation, and device automation at individual steps need a verified API route before being promised. Do not infer controller support from a feature's presence in Bitwig's UI.
