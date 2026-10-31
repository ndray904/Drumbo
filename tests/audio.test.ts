import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine, starter } from "../src/audio.ts";
import { defaultKit, type Song } from "../src/model.ts";
const clock = { currentTime: 0 };
function setup() {
  const e = new Engine();
  e.ctx = clock as AudioContext;
  e.kit = defaultKit();
  e.channel = 9;
  e.song = {
    name: "test",
    duration: 2,
    bpm: 120,
    tempos: 1,
    channels: [0, 9],
    selected: 9,
    hits: [
      { time: 0, note: 36, velocity: 0.8, channel: 9 },
      { time: 0.5, note: 38, velocity: 0.5, channel: 9 },
      { time: 0.5, note: 60, velocity: 1, channel: 0 },
      { time: 1, note: 42, velocity: 0.7, channel: 9 },
    ],
  };
  const calls: number[][] = [];
  e.hit = (...args: number[]) => {
    calls.push(args);
  };
  clock.currentTime = 0;
  return { e, calls };
}
(globalThis as any).window = { setInterval: () => 1 };
test("scheduler preserves velocity, channels, and seek position", () => {
  const { e, calls } = setup();
  e.play();
  assert.deepEqual(calls[0], [36, 0.8, 0]);
  clock.currentTime = 0.45;
  (e as any).tick();
  assert.equal(calls[1][0], 38);
  assert.equal(calls[1][2], 0.5);
  assert.equal(calls.length, 2);
  e.pause();
  assert.equal(e.position, 0.45);
  e.seek(1);
  e.play();
  assert.equal(calls.at(-1)![0], 42);
  e.stop();
  assert.equal(e.position, 0);
  assert.equal(e.playing, false);
});
test("tempo changes preserve current musical position", () => {
  const { e, calls } = setup();
  e.play();
  clock.currentTime = 0.25;
  e.tempo(2);
  assert.equal(e.position, 0.25);
  clock.currentTime = 0.35;
  (e as any).tick();
  assert.equal(calls.at(-1)![0], 38);
  assert.equal(calls.at(-1)![2], 0.375);
  e.stop();
});
test("loop restarts, one shot stops, and all-channel override includes melodic notes in GM range", () => {
  const { e, calls } = setup();
  e.channel = -1;
  e.play();
  clock.currentTime = 0.45;
  (e as any).tick();
  assert(calls.some((c) => c[0] === 60));
  clock.currentTime = 2;
  (e as any).tick();
  assert.equal(e.playing, true);
  assert.equal(e.position, 0);
  e.loop = false;
  clock.currentTime = 4;
  (e as any).tick();
  assert.equal(e.playing, false);
  assert.equal(e.position, 0);
});
test("all 47 starter sounds produce finite, non-silent audio", () => {
  const context = {
    sampleRate: 8000,
    createBuffer: (_channels: number, length: number) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
  };
  for (let note = 35; note <= 81; note++) {
    const buffer = starter(context as unknown as BaseAudioContext, note);
    const values = buffer.getChannelData(0);
    assert(values.length > 0);
    assert(values.every(Number.isFinite));
    assert(values.some((v) => Math.abs(v) > 0.01));
  }
});
test("loop events use the original audio clock across boundaries", () => {
  const { e, calls } = setup();
  e.play();
  clock.currentTime = 1.95;
  (e as any).tick();
  assert.deepEqual(calls.at(-1), [36, 0.8, 2]);
  clock.currentTime = 2.02;
  assert(Math.abs(e.now() - 0.02) < 1e-9);
  e.pause();
  assert(Math.abs(e.position - 0.02) < 1e-9);
});
