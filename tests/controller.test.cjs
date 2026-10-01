const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function value(initial) {
    let current = initial;
    const observers = [];
    return {
        get: () => current,
        set: next => { current = next; observers.forEach(fn => fn(next)); },
        addValueObserver: fn => { observers.push(fn); fn(current); },
        markInterested() {},
        toggle() { this.set(!current); }
    };
}
function setup() {
    const calls = { scroll: [], toggles: [], moves: [], messages: [], shown: 0 };
    const exists = value(true), start = value(0), length = value(16), scene = value(0), track = value(0);
    const noteTrack = value(true);
    const clip = {
        exists: () => exists, getLoopStart: () => start, getLoopLength: () => length,
        clipLauncherSlot: () => ({ sceneIndex: () => scene }),
        getTrack: () => ({ position: () => track, canHoldNoteData: () => noteTrack }),
        setStepSize: size => { calls.size = size; }, scrollToKey() {},
        scrollToStep: x => calls.scroll.push(x),
        toggleStep: (x, key, velocity) => calls.toggles.push([calls.scroll.at(-1) + x, key, velocity]),
        moveStep: (...args) => calls.moves.push(args),
        showInEditor: () => calls.shown++, selectStepContents() {},
        isLoopEnabled: () => value(true)
    };
    const context = vm.createContext({
        host: { requestFlush() {}, scheduleTask() {}, showPopupNotification: text => calls.messages.push(text) },
        Date, console, quantizeAmount: 1,
        MoveNavigation: { requestedTrack: null, toast: text => calls.messages.push(text) },
        MoveFeedback: { selectStep() {}, notify() {}, showClip() {} },
        MoveSceneStop: { cancel() {} },
        MoveProtocol: { text() {}, bars() {} }
    });
    function load(file) { vm.runInContext(fs.readFileSync(path.join(root, 'Controller Scripts', file), 'utf8'), context, { filename: file }); }
    ['MoveHardware.js', 'MoveNotes.js', 'MoveSequencer.js', 'MoveWorkflow.js'].forEach(load);
    context.MoveNotes.cursorClip = clip;
    context.MoveNotes.cursorTrack = { position: () => track, exists: () => value(true), canHoldNoteData: () => noteTrack,
        createNewLauncherClip: index => { calls.created = index; } };
    context.MoveSequencer.init(clip);
    context.MoveSequencer.sync();
    return { context, calls, clip, exists, start, length, scene, track, noteTrack, load };
}
const modifiers = () => ({ shift: false, loop: false, mute: false, copy: false, del: false });

test('four pages write to their displayed absolute positions and cannot leave the loop', () => {
    const { context: c, calls } = setup();
    for (let i = 0; i < 8; i++) c.MoveSequencer.navigate(-1);
    assert.equal(c.MoveSequencer.page, 0);
    for (let p = 0; p < 4; p++) {
        assert.equal(c.MoveSequencer.positionLabel(), `Beat ${p * 4 + 1}-${p * 4 + 5}`);
        c.MoveNotes.handleNote(0x90, 16, 100, modifiers());
        c.MoveNotes.handleNote(0x80, 16, 0, modifiers());
        c.MoveSequencer.navigate(1);
    }
    assert.deepEqual(calls.toggles.map(x => x[0]), [0, 16, 32, 48]);
    assert.equal(c.MoveSequencer.page, 3);
    assert.ok(calls.scroll.every(x => x >= 0 && x <= 48));
});

test('nonzero fractional loops disable out-of-range steps and clamp after shortening', () => {
    const { context: c, start, length } = setup();
    start.set(4.125); length.set(4.25); c.MoveSequencer.sync();
    assert.equal(c.MoveSequencer.page, 1);
    assert.equal(c.MoveSequencer.canEdit(0), false);
    assert.equal(c.MoveSequencer.canEdit(1), true);
    c.MoveSequencer.navigate(1);
    assert.equal(c.MoveSequencer.canEdit(1), true);
    assert.equal(c.MoveSequencer.canEdit(2), false);
    length.set(1); c.MoveSequencer.sync();
    assert.equal(c.MoveSequencer.page, 1);
});

test('resolution changes preserve musical position and cannot interrupt a held edit', () => {
    const { context: c } = setup();
    c.MoveSequencer.navigate(1);
    c.MoveSequencer.changeResolution(1);
    assert.equal(c.MoveSequencer.page * c.MoveSequencer.pageBeats(), 4);
    assert.equal(c.MoveSequencer.stepSize(), 0.125);
    c.MoveNotes.heldStep = 0;
    c.MoveSequencer.changeResolution(-1);
    assert.equal(c.MoveSequencer.stepSize(), 0.125);
});

test('changing clip cancels an in-flight step release and returns to first page', () => {
    const { context: c, calls, scene } = setup();
    c.MoveSequencer.navigate(1);
    c.MoveNotes.handleNote(0x90, 16, 100, modifiers());
    scene.set(2);
    c.MoveNotes.handleNote(0x80, 16, 0, modifiers());
    assert.equal(calls.toggles.length, 0);
    c.MoveSequencer.sync();
    assert.equal(c.MoveSequencer.page, 0);
});

test('missing clips and audio-only tracks cannot receive step writes', () => {
    const { context: c, calls, exists, noteTrack } = setup();
    exists.set(false); c.MoveSequencer.sync();
    c.MoveNotes.handleNote(0x90, 16, 100, modifiers());
    c.MoveNotes.handleNote(0x80, 16, 0, modifiers());
    exists.set(true); noteTrack.set(false); c.MoveSequencer.sync();
    c.MoveNotes.handleNote(0x90, 16, 100, modifiers());
    c.MoveNotes.handleNote(0x80, 16, 0, modifiers());
    assert.equal(calls.toggles.length, 0);
});

test('nudging at the first step cannot put notes before the loop', () => {
    const { context: c, calls } = setup();
    c.MoveNotes.heldStep = 0; c.MoveNotes.stepHas = { '0_60': true };
    c.MoveNotes.moveHeldStep(-1, 0, 'Nudge');
    assert.equal(calls.moves.length, 0);
    c.MoveNotes.handleNote(0x80, 16, 0, modifiers());
    assert.equal(calls.toggles.length, 0, 'blocked nudge must not turn release into a toggle');
});

test('Workflow and Tempo adjust their own targets and Back closes the screen', () => {
    const { context: c } = setup();
    const launcher = value(false), arranger = value(false);
    let tempoDelta = 0;
    c.MoveTransport = { transport: {
        tempo: () => ({ incRaw: delta => tempoDelta += delta }),
        isClipLauncherAutomationWriteEnabled: () => launcher,
        isArrangerAutomationWriteEnabled: () => arranger
    } };
    c.MoveWorkflow.open('workflow');
    c.MoveWorkflow.row = 2;
    c.MoveWorkflow.handleCC(c.MoveHardware.CC.JOG_WHEEL, 1, modifiers());
    assert.equal(launcher.get(), false);
    assert.equal(arranger.get(), true);
    c.MoveWorkflow.open('tempo');
    c.MoveWorkflow.handleCC(c.MoveHardware.CC.JOG_WHEEL, 1, { shift: true });
    assert.equal(tempoDelta, 0.1);
    c.MoveWorkflow.handleCC(c.MoveHardware.CC.BACK, 127, modifiers());
    assert.equal(c.MoveWorkflow.screen, null);
});

test('Step 16 uses the global scene bank, not visible track stops', () => {
    const { context: c, load } = setup();
    load('MoveGrid.js');
    let stopped = 0;
    c.MoveGrid.allScenes = { stop: () => stopped++ };
    c.MoveGrid.handleNote(0x90, 31, 100, modifiers(), false);
    assert.equal(stopped, 1);
});

test('Session track modifiers do not select a track or trigger a Mute tap', () => {
    const { context: c, load } = setup();
    load('MoveGrid.js');
    const actions = [];
    c.MoveGrid.trackBank = { getItemAt: index => ({
        exists: () => value(true), trackType: () => value("Instrument"), selectInEditor: () => actions.push(['select', index]),
        mute: () => ({ toggle: () => actions.push(['mute', index]) }),
        deleteObject: () => actions.push(['delete', index]), duplicate: () => actions.push(['copy', index])
    }) };
    c.MoveNavigation.channelAt = i => c.MoveGrid.trackBank.getItemAt(i);
    c.MoveNavigation.selectTrack = track => track.selectInEditor();
    const mute = { ...modifiers(), mute: true };
    c.MoveGrid.handleNote(0x90, 20, 100, mute, false);
    assert.equal(mute.muteUsed, true);
    c.MoveGrid.handleNote(0x90, 22, 100, { ...modifiers(), copy: true }, false);
    c.MoveGrid.handleNote(0x90, 24, 100, { ...modifiers(), del: true }, false);
    assert.deepEqual(actions, [['mute', 2], ['copy', 3], ['delete', 4]]);
    c.MoveGrid.handleNote(0x90, 28, 100, modifiers(), false);
    assert.equal(c.MoveGrid.heldTrack, 6);
    c.MoveGrid.handleNote(0x80, 28, 0, modifiers(), false);
    assert.equal(c.MoveGrid.heldTrack, -1);
});

test('Bitwig editor following respects opt-out and indicates only the active mapping', () => {
    const { context: c, load, calls } = setup();
    load('MoveFeedback.js');
    c.MoveFeedback.follow = false; c.MoveFeedback.showClip();
    assert.equal(calls.shown, 0);
    c.MoveFeedback.follow = true; c.MoveFeedback.showClip();
    assert.equal(calls.shown, 1);
    const indications = {};
    const parameter = name => ({ setIndication: on => indications[name] = on });
    c.MoveNavigation.remoteControls = { getParameter: i => parameter(`remote${i}`) };
    c.MoveNavigation.trackBank = { getItemAt: i => ({ volume: () => parameter(`volume${i}`),
        pan: () => parameter(`pan${i}`), sendBank: () => ({ getItemAt: s => parameter(`send${s}:${i}`) }) }) };
    c.MoveNavigation.channelAt = i => c.MoveNavigation.trackBank.getItemAt(i);
    c.ui = { mode: 'session' }; c.modifiers = modifiers();
    c.MoveFeedback.updateIndications();
    c.ui.mode = 'mixer'; c.modifiers.mute = true;
    c.MoveFeedback.updateIndications();
    assert.deepEqual(Object.keys(indications).filter(key => indications[key]), Array.from({ length: 8 }, (_, i) => `pan${i}`));
    c.modifiers.copy = true; c.modifiers.shift = true;
    c.MoveFeedback.updateIndications();
    assert.deepEqual(Object.keys(indications).filter(key => indications[key]), Array.from({ length: 7 }, (_, i) => `send1:${i}`));
});

test('main MIDI routing releases a held step even if Shift is pressed later', () => {
    const { context: c, calls, load } = setup();
    c.loadAPI = () => {}; c.load = () => {};
    Object.assign(c.host, { setShouldFailOnDeprecatedUse() {}, defineController() {}, defineMidiPorts() {}, addDeviceNameBasedDiscoveryPair() {} });
    load('Move.control.js');
    c.ui.mode = 'note';
    c.MoveBrowser = { isOpen: () => false };
    c.MoveTransport = { handleCC: () => false };
    c.MoveTrackControls = { handleCC: () => false };
    c.onMidi0(0x90, 16, 100);
    c.onMidi0(0xB0, c.MoveHardware.CC.SHIFT, 127);
    assert.equal(c.MoveNotes.heldStep, 0, 'Shift must remain usable for fine edits');
    c.onMidi0(0x80, 16, 0);
    assert.equal(c.MoveNotes.heldStep, -1);
    assert.equal(calls.toggles.length, 1);
    // A shortcut press must never become a note toggle on releasing Shift first.
    c.onMidi0(0x90, 18, 100);
    c.onMidi0(0xB0, c.MoveHardware.CC.SHIFT, 0);
    c.onMidi0(0x80, 18, 0);
    assert.equal(calls.toggles.length, 1);
});

test('all controller JavaScript parses and every load target is packaged from the source folder', () => {
    const folder = path.join(root, 'Controller Scripts');
    for (const file of fs.readdirSync(folder).filter(x => x.endsWith('.js'))) {
        const source = fs.readFileSync(path.join(folder, file), 'utf8');
        new vm.Script(source, { filename: file });
        for (const match of source.matchAll(/load\("([^"]+)"\)/g)) {
            assert.ok(fs.existsSync(path.join(folder, match[1])), match[1]);
        }
    }
});

// The critical new behavior: a first step waits for its own clip, never another track.
test('first step creates a default-length clip and writes after that clip arrives', () => {
    const { context: c, exists, calls } = setup();
    exists.set(false); c.MoveSequencer.sync();
    c.MoveNotes.handleNote(0x90, 19, 100, modifiers());
    c.MoveNotes.handleNote(0x80, 19, 0, modifiers());
    assert.equal(calls.created, 0);
    assert.equal(calls.toggles.length, 0);
    exists.set(true); c.MoveSequencer.sync(); c.MoveNotes.flushPendingNotes();
    assert.deepEqual(calls.toggles, [[3, 60, 100]]);
    c.MoveNotes.flushPendingNotes();
    assert.equal(calls.toggles.length, 1);
});

test('track handoff blocks old-clip edits and cancels queued creation writes', () => {
    const { context: c, calls, exists, track } = setup();
    const selected = value(1);
    c.MoveNotes.cursorTrack.position = () => selected;
    assert.equal(c.MoveSequencer.canEdit(0), false);
    c.MoveNotes.handleNote(0x90, 16, 100, modifiers());
    assert.equal(calls.created, undefined, 'do not create against a stale existing clip');
    track.set(1); exists.set(false); c.MoveSequencer.sync();
    c.MoveNotes.handleNote(0x90, 16, 100, modifiers());
    assert.equal(calls.created, 0);
    c.MoveNotes.trackGeneration++;
    selected.set(2); track.set(2); exists.set(true); c.MoveSequencer.sync();
    c.MoveNotes.flushPendingNotes();
    assert.equal(calls.toggles.length, 0);
    assert.equal(c.MoveNotes.pendingNotes, null);
});

test('scene stop reaches every track page, skips other scenes and cancels stale requests', () => {
    const { context: c, load } = setup();
    load('MoveSceneStop.js');
    const tasks = [], stopped = [];
    c.host.scheduleTask = task => tasks.push(task);
    const scene = value(0), scroll = value(0);
    const tracks = [
        { playing: true }, { playing: false }, { group: true, playing: true },
        { recordQueued: true }, { playing: false }, { queued: true }, { master: true, playing: true }
    ];
    c.MoveSceneStop.width = 2;
    c.MoveSceneStop.bank = {
        itemCount: () => value(tracks.length),
        scrollPosition: () => ({ get: scroll.get, set: x => scroll.set(Math.min(x, tracks.length - 2)) }),
        sceneBank: () => ({ scrollPosition: () => scene, getItemAt: () => ({ sceneIndex: () => scene }) }),
        getItemAt: i => {
            const index = scroll.get() + i, track = tracks[index];
            return {
                exists: () => value(true), isGroup: () => value(!!track.group),
                trackType: () => value(track.master ? 'Master' : 'Instrument'),
                clipLauncherSlotBank: () => ({
                    isMasterTrackContentShownOnTrackGroups: () => value(false),
                    stop: () => stopped.push(index),
                    getItemAt: () => ({
                        sceneIndex: () => scene, hasContent: () => value(true),
                        isPlaying: () => value(!!track.playing), isRecording: () => value(false),
                        isPlaybackQueued: () => value(!!track.queued),
                        isRecordingQueued: () => value(!!track.recordQueued)
                    })
                })
            };
        }
    };
    c.MoveSceneStop.stop(9);
    while (tasks.length) tasks.shift()();
    assert.deepEqual(stopped, [0, 3, 5], 'includes offscreen children and queued clips, without duplicate final-page stops');
    c.MoveSceneStop.stop(9);
    c.MoveSceneStop.cancel();
    while (tasks.length) tasks.shift()();
    assert.deepEqual(stopped, [0, 3, 5], 'a later launch cancels pending stop tasks');
});

test('session columns are tracks: empty slots stop unarmed tracks and only armed tracks get clips', () => {
    const { context: c, load, calls } = setup();
    load('MoveGrid.js');
    const actions = [];
    const armed = value(false);
    const slot = { hasContent: () => value(false), select() {}, sceneIndex: () => value(5), record: () => actions.push('record') };
    const track = { exists: () => value(true), trackType: () => value('Instrument'), arm: () => armed, canHoldNoteData: () => value(true), name: () => value('Bass'),
        stop: () => actions.push('stop'), createNewLauncherClip: scene => actions.push(['create', scene]) };
    c.MoveGrid.trackBank = { getItemAt: () => track };
    c.MoveGrid.slotAt = (t, s) => { actions.push(['slot', t, s]); return slot; };
    c.MoveNavigation.selectTrack = () => {};
    c.MoveBrowser = { browseIfEmpty() {} };
    c.setMode = mode => actions.push(['mode', mode]);
    // Third column, top row = track 3, scene 1
    c.MoveGrid.handleNote(0x90, c.MoveHardware.getPadNote(2, 0), 100, modifiers());
    assert.deepEqual(actions, [['slot', 2, 0], 'stop']);
    actions.length = 0; armed.set(true);
    c.MoveGrid.handleNote(0x90, c.MoveHardware.getPadNote(2, 0), 100, modifiers());
    assert.deepEqual(actions, [['slot', 2, 0], ['create', 5], ['mode', 'note']]);
    assert.ok(calls.messages.includes('Stop: Bass'));
});

test('drum modifier pads map top-left first, edit with the wheel and reset on double tap', () => {
    const { context: c, load } = setup();
    c.Java = { type: () => ({ values: () => [] }) };
    load('MoveDrumMods.js');
    const mods = c.MoveDrumMods;
    mods.init();
    assert.equal(mods.indexForPad(28), 0, 'top row, fifth pad = Velocity');
    assert.equal(mods.indexForPad(7), 15, 'bottom-right = Rpt vel curve');
    assert.equal(mods.indexForPad(3), -1, 'left half plays drums');
    mods.press(0); mods.release(0);
    mods.held = 0;
    mods.turn(5, false);
    assert.equal(mods.values[0], 110);
    mods.turn(100, false);
    assert.equal(mods.values[0], 127, 'clamped');
    mods.lastTapTime = 0; mods.press(0);
    assert.equal(mods.values[0], 127, 'a slow second tap does not reset');
    mods.press(0);
    assert.equal(mods.values[0], 100, 'double tap resets to default');
});


test('last-touched volume retains a pinned GUI target across controller focus and device changes', () => {
    const { context: c, load } = setup();
    const tasks = [], edits = [];
    const first = { name: 'Cutoff' }, second = { name: 'Cutoff' };
    let gui = null;
    let pins = 0;
    const proxies = [];
    c.host.scheduleTask = task => tasks.push(task);
    c.host.createLastClickedParameter = () => {
        const locked = value(false);
        let pinned = null;
        const current = () => locked.get() ? pinned : gui;
        const observed = getter => ({ get: getter, markInterested() {} });
        const parameter = {
            current,
            exists: () => observed(() => current() !== null),
            name: () => observed(() => current()?.name || ''),
            value: () => ({ markInterested() {}, displayedValue: () => observed(() => '50%') }),
            createEqualsValue: other => observed(() => current() === other.current()),
            inc: delta => edits.push([current(), delta])
        };
        const proxy = {
            isLocked: () => locked,
            parameter: () => parameter,
            smartToggleLock() {
                pins++;
                if (locked.get() && pinned === gui) locked.set(false);
                else { pinned = gui; locked.set(true); }
            }
        };
        proxies.push(proxy);
        return proxy;
    };
    load('MoveLastTouched.js');
    load('MoveNavigation.js');
    c.MoveLastTouched.init(c.host);
    c.MoveNavigation.volumeLastTouched = true;
    c.MoveNavigation.focusParameter = () => {};
    c.MoveNavigation.remoteControls = { getParameter: () => ({ inc: delta => edits.push(['macro', delta]) }) };
    c.MoveTrackControls = { heldTrack: -1 };
    c.MoveGrid = { heldTrack: -1 };
    assert.equal(c.MoveNavigation.volumeParameter(), null);

    gui = first;
    c.MoveLastTouched.sync();
    assert.equal(c.MoveNavigation.volumeParameter().current(), first);
    // Repeated flushes while the host applies the pin must not toggle it off.
    c.MoveLastTouched.sync();
    assert.equal(pins, 1);
    tasks.shift()();
    c.MoveLastTouched.sync();
    assert.equal(pins, 1);

    c.MoveNavigation.handleCC(c.MoveHardware.CC.KNOB_FIRST, 1, modifiers());
    gui = null; // Bitwig's live GUI reference clears after controller focus/navigation.
    c.MoveLastTouched.sync();
    c.MoveNavigation.handleCC(c.MoveHardware.CC.MASTER, 1, modifiers());
    assert.equal(edits.at(-1)[0], first);
    assert.equal(proxies[1].isLocked().get(), true);

    // A different mouse target with the same name must replace the retained target.
    gui = second;
    c.MoveLastTouched.sync();
    tasks.shift()();
    assert.equal(c.MoveNavigation.volumeParameter().current(), second);
    assert.equal(pins, 2);
    gui = null;
    c.MoveLastTouched.sync();
    assert.equal(c.MoveNavigation.volumeParameter().current(), second);
    // Explicit held-track volume still takes precedence.
    const trackVolume = {};
    c.MoveTrackControls.heldTrack = 0;
    c.MoveNavigation.channelAt = () => ({ volume: () => trackVolume });
    assert.equal(c.MoveNavigation.volumeParameter(), trackVolume);
});


test('Session distinguishes empty slots from unused columns and exposes Main only at Step 15', () => {
    const { context: c, load } = setup();
    load('MoveGrid.js');
    const C = c.MoveHardware.COLOR, leds = {}, actions = [];
    const track = (exists, type) => ({
        exists: () => value(exists), trackType: () => value(type),
        color: () => ({ red: () => 1, green: () => 0, blue: () => 0 }),
        selectInEditor: () => actions.push('select ' + type)
    });
    const empty = track(false, ''), instrument = track(true, 'Instrument'), main = track(true, 'Master');
    const slot = {
        isPlaybackQueued: () => value(false), isRecordingQueued: () => value(false),
        isRecording: () => value(false), hasContent: () => value(false)
    };
    assert.equal(c.MoveGrid.slotColor(empty, slot, false), C.BLACK);
    assert.equal(c.MoveGrid.slotColor(main, slot, false), C.BLACK);
    const dim = c.MoveGrid.slotColor(instrument, slot, false);
    assert.notEqual(dim, C.BLACK);
    assert.ok(Math.max(...c.MoveHardware.PALETTE[dim]) <= 32);
    c.MoveGrid.trackBank = { getItemAt: i => i === 2 ? main : empty };
    c.MoveBrowser = { newInstrumentTrack: () => actions.push('create') };
    c.MoveGrid.handlePad({ col: 0, row: 0 }, modifiers());
    c.MoveGrid.handlePad({ col: 2, row: 0 }, modifiers());
    assert.deepEqual(actions, []);
    c.MoveNavigation.channelAt = i => i === 7 ? main : c.MoveGrid.trackBank.getItemAt(i);
    c.MoveNavigation.trackSelected = [];
    c.MoveNavigation.selectTrack = t => t.selectInEditor();
    c.MoveProtocol.ledNote = (note, color) => { leds[note - 16] = color; };
    c.MoveGrid.allScenes = { stop: () => actions.push('stop all') };
    c.MoveGrid.updateStepLEDs();
    assert.equal(leds[4], C.BLACK);
    assert.equal(leds[5], C.BLACK);
    assert.notEqual(leds[14], C.BLACK);
    assert.equal(leds[15], C.DIM_RED);
    c.MoveGrid.handleStep(4, modifiers());
    c.MoveGrid.handleStep(14, modifiers());
    c.MoveGrid.handleStep(15, modifiers());
    assert.deepEqual(actions, ['select Master', 'stop all']);
});

test('new-track shortcuts append before returns and open the appropriate view', () => {
    const { context: c, load } = setup();
    load('MoveBrowser.js');
    const tasks = [], actions = [];
    let count = 2, scroll = 0, position = 0, noteTrack = true;
    const appended = { exists: () => value(true), position: () => value(2),
        selectInEditor: () => { position = 2; actions.push('select new'); } };
    c.host.scheduleTask = task => tasks.push(task);
    c.MoveBrowser.newTrackBank = { itemCount: () => ({ get: () => count }),
        scrollPosition: () => ({ get: () => scroll, set: x => { scroll = x; } }), getItemAt: () => appended };
    c.MoveBrowser.cursorTrack = { exists: () => value(true), position: () => ({ get: () => position }),
        canHoldNoteData: () => ({ get: () => noteTrack }) };
    c.MoveBrowser.replaceInstrument = () => actions.push('browse');
    c.MoveTransport = { application: {
        createInstrumentTrack: index => { assert.equal(index, -1); count++; noteTrack = true; },
        createAudioTrack: index => { assert.equal(index, -1); count++; noteTrack = false; }
    } };
    c.setMode = mode => actions.push(mode);
    c.MoveWorkflow.handleShiftStep(0);
    while (tasks.length) tasks.shift()();
    assert.deepEqual(actions, ['select new', 'note', 'browse']);
    actions.length = 0; count = 2; scroll = 0; position = 0;
    c.MoveWorkflow.handleShiftStep(1);
    while (tasks.length) tasks.shift()();
    assert.deepEqual(actions, ['select new', 'session']);
    // Selecting something else cancels delayed browser/selection work.
    actions.length = 0; count = 2;
    c.MoveWorkflow.handleShiftStep(0);
    c.MoveBrowser.browseRequest++;
    while (tasks.length) tasks.shift()();
    assert.deepEqual(actions, []);
    assert.equal(c.MoveBrowser.creatingTrack, false);
});
