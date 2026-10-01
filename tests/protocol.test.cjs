const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function moduleHost() {
    let now = 1000;
    const output = [], drawing = [];
    const source = fs.readFileSync(path.join(root, 'src/ui.js'), 'utf8');
    const bindings = {};
    for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from[^;]+;/g)) {
        match[1].split(',').map(x => x.trim()).forEach((name, i) => bindings[name] = i);
    }
    Object.assign(bindings, {
        MidiNoteOn: 0x90, MidiNoteOff: 0x80, MidiCC: 0xB0,
        MovePads: Array.from({ length: 32 }, (_, i) => 68 + i),
        MoveSteps: Array.from({ length: 16 }, (_, i) => 16 + i),
        isNoiseMessage: () => false,
        setLED: (n, v) => output.push(['note', n, v]),
        setButtonLED: (n, v) => output.push(['cc', n, v]),
        move_midi_external_send: p => output.push(['external', ...p]),
        move_midi_internal_send: p => output.push(['internal', ...p]),
        clear_screen: () => drawing.push(['clear']),
        print: (x, y, text) => drawing.push(['text', x, y, text]),
        text_width: text => text.length * 6,
        fill_rect: (x, y, w, h) => drawing.push(['fill', x, y, w, h]),
        draw_rect: (x, y, w, h) => drawing.push(['rect', x, y, w, h]),
        Date: { now: () => now }, console
    });
    const context = vm.createContext(bindings);
    vm.runInContext(source.replace(/import\s*\{[^}]+\}\s*from[^;]+;/g, '') + '\nglobalThis.inspectState = () => state;', context);
    function feed(bytes) {
        for (let i = 0; i < bytes.length; i += 3) context.onMidiMessageExternal(bytes.slice(i, i + 3));
    }
    function command(cmd, payload = []) { feed([0xF0, 0x7D, 0x4D, 0x42, cmd, ...payload, 0xF7]); }
    context.init();
    return { context, output, drawing, command, feed, state: context.inspectState(), advance: ms => now += ms };
}
function controllerHost() {
    const sent = [], scheduled = [];
    const context = vm.createContext({ host: { scheduleTask: fn => scheduled.push(fn), println() {}, requestFlush() {} }, Date });
    vm.runInContext(fs.readFileSync(path.join(root, 'Controller Scripts/MoveProtocol.js'), 'utf8'), context);
    context.MoveProtocol.init({ sendSysex: msg => sent.push(msg) });
    return { protocol: context.MoveProtocol, sent, scheduled };
}

test('negotiates optional strip only with capable modules; legacy ACK still connects', () => {
    const { protocol, sent } = controllerHost();
    protocol.onSysex('f07d4d424102f7');
    assert.equal(protocol.isConnected(), true);
    protocol.sequence([0, 0, ...Array(16).fill(4)]);
    protocol.flush();
    assert.equal(sent.some(x => x.startsWith('f07d4d4207')), false);
    protocol.onSysex('f07d4d42410201f7');
    protocol.flush();
    assert.equal(sent.some(x => x.startsWith('f07d4d4207')), true);
});

test('malformed or incompatible replies cannot establish a controller connection', () => {
    const { protocol, scheduled, sent } = controllerHost();
    ['f07d4d424102', 'f07d4d4241fff7', 'f07d4d424103f7', 'f07d4d424000f7'].forEach(x => protocol.onSysex(x));
    assert.equal(protocol.isConnected(), false);
    scheduled.shift()();
    assert.equal(sent.filter(x => x.startsWith('f07d4d427e')).length, 2, 'retry HELLO while disconnected');
});

test('module re-announces readiness on restart, causing full feedback replay', () => {
    const m = moduleHost();
    m.context.tick();
    assert.ok(m.output.some(x => x[0] === 'external'));
    const { protocol, sent } = controllerHost();
    protocol.onSysex('f07d4d42410201f7');
    protocol.text(1, 'Bass'); protocol.flush();
    sent.length = 0;
    protocol.flush(); assert.equal(sent.length, 0);
    protocol.onSysex('f07d4d42410201f7'); protocol.flush();
    assert.ok(sent.some(x => x.startsWith('f07d4d420100')));
});

test('actual module packets negotiate with the controller and render its strip', () => {
    const m = moduleHost();
    const { protocol, sent } = controllerHost();
    m.context.tick();
    const reply = [];
    for (const p of m.output.filter(x => x[0] === 'external')) {
        const cin = p[1] & 15;
        const count = cin === 4 ? 3 : cin - 4;
        reply.push(...p.slice(2, 2 + count));
    }
    protocol.onSysex(reply.map(x => x.toString(16).padStart(2, '0')).join(''));
    assert.equal(protocol.isConnected(), true);
    protocol.text(1, 'Drums');
    protocol.sequence([4, 0, 4, 2, 1, 2, 9]);
    sent.length = 0; protocol.flush();
    for (const hex of sent) m.feed(hex.match(/../g).map(x => parseInt(x, 16)));
    m.context.tick();
    assert.equal(m.state.lines[0], 'Drums');
    assert.equal(m.state.sequence[0], 4);
    assert.equal(m.state.sequence[3], 2);
});

test('malformed module payloads are ignored; real-time bytes do not corrupt SysEx', () => {
    const m = moduleHost();
    m.command(0x01, [9, 65]);
    m.command(0x06, [1, 2]);
    m.command(0x07, [4, 0, 9, 0, 0, 1, 1]);
    m.command(0x55, [1]);
    assert.equal(m.state.connected, false);
    m.feed([0xF0, 0x7D, 0xF8, 0x4D, 0x42, 0x01, 0, 65, 0xFA, 66, 0xF7]);
    assert.equal(m.state.lines[0], 'AB');
    m.feed([0xF0, 0x7D, 0x4D, 0x42, 0x01, 0, ...Array(600).fill(65), 0xF7]);
    assert.equal(m.state.lines[0], 'AB');
    m.command(0x01, [0, 67]);
    assert.equal(m.state.lines[0], 'C');
});

test('clear completes before fresh LED feedback; every tick respects total packet budget', () => {
    const m = moduleHost();
    m.command(0x7E, [2]);
    m.command(0x02, [68, 55]);
    m.command(0x04, [40, 100, 0, 0, 41, 0, 100, 0]);
    for (let tick = 0; tick < 30; tick++) {
        const before = m.output.length;
        m.context.tick();
        assert.ok(m.output.length - before <= 12, 'shared hardware/reply budget');
    }
    assert.deepEqual(m.output.filter(x => x[0] === 'note' && x[1] === 68).at(-1), ['note', 68, 55]);
    assert.equal(m.state.pendingLeds.size, 0);
    assert.equal(m.state.txQueue.length, 0);
});

test('LED floods coalesce to latest value and timeout discards stale work', () => {
    const m = moduleHost();
    for (let i = 0; i < 400; i++) m.command(0x02, [68, i % 128]);
    assert.equal(m.state.pendingLeds.size, 1);
    m.advance(5000); m.context.tick();
    assert.equal(m.state.connected, false);
    assert.equal(m.state.pendingLeds.size, 0);
    for (let i = 0; i < 20; i++) m.context.tick();
    assert.ok(m.output.filter(x => x[0] === 'note').every(x => x[2] === 0));
});

test('display clips text, draws the bar overview within bounds, and skips unchanged ticks', () => {
    const m = moduleHost();
    m.command(0x01, [0, ...Array(24).fill(65)]);
    m.command(0x07, [64, 0, 64, 64, 60, 64, 16]);
    m.context.tick();
    const count = m.drawing.length;
    m.context.tick();
    assert.equal(m.drawing.length, count);
    assert.ok(m.drawing.filter(x => x[0] === 'text').every(x => x[3].length * 6 <= 124));
    assert.ok(m.drawing.filter(x => x[0] === 'fill' || x[0] === 'rect')
        .every(([, x, y, w, h]) => x >= 0 && y >= 0 && x + w <= 128 && y + h <= 64));
});
