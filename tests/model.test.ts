import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GM_NAMES,
  SLOT_NOTES,
  gmName,
  parseMidi,
  defaultKit,
  validateKit,
  audible,
  demo,
} from "../src/model.ts";
function midi(format: number, tracks: number[][]) {
  const chunks = tracks.flatMap((t) => [
    77,
    84,
    114,
    107,
    0,
    0,
    0,
    t.length,
    ...t,
  ]);
  return Uint8Array.from([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    format,
    0,
    tracks.length,
    1,
    224,
    ...chunks,
  ]).buffer;
}
const end = [0, 255, 47, 0];
test("all GM percussion notes have canonical names, no offset errors", () => {
  assert.equal(GM_NAMES.length, 47);
  assert.equal(gmName(35), "Acoustic Bass Drum");
  assert.equal(gmName(42), "Closed Hi-Hat");
  assert.equal(gmName(56), "Cowbell");
  assert.equal(gmName(81), "Open Triangle");
  assert.equal(new Set(GM_NAMES).size, 47);
  assert.equal(new Set(SLOT_NOTES).size, 16);
});
test("format 0 respects velocity and selects channel 10", () => {
  const song = parseMidi(
    midi(0, [[0, 153, 36, 64, 131, 96, 137, 36, 0, ...end]]),
    "zero.mid",
  );
  assert.equal(song.selected, 9);
  assert.equal(song.hits[0].note, 36);
  assert.equal(song.hits[0].velocity, 64 / 127);
  assert.equal(song.hits[0].time, 0);
});
test("format 1 tempo changes convert beats into correct absolute seconds", () => {
  const conductor = [
    0,
    255,
    81,
    3,
    7,
    161,
    32,
    131,
    96,
    255,
    81,
    3,
    15,
    66,
    64,
    ...end,
  ];
  const notes = [
    0,
    144,
    60,
    100,
    131,
    96,
    128,
    60,
    0,
    0,
    153,
    38,
    127,
    131,
    96,
    137,
    38,
    0,
    0,
    153,
    36,
    90,
    120,
    137,
    36,
    0,
    ...end,
  ];
  const song = parseMidi(midi(1, [conductor, notes]), "tempo.mid");
  assert.equal(song.tempos, 2);
  assert.deepEqual(song.channels, [0, 9]);
  assert.equal(song.selected, 9);
  assert.equal(song.hits[1].time, 0.5);
  assert.equal(song.hits[2].time, 1.5);
});
test("channel fallback and unsupported files", () => {
  const song = parseMidi(
    midi(0, [[0, 146, 42, 100, 120, 130, 42, 0, ...end]]),
    "manual.mid",
  );
  assert.equal(song.selected, 2);
  assert.throws(() => parseMidi(midi(2, [end]), "bad.mid"), /formats/);
  assert.throws(() => parseMidi(new ArrayBuffer(2), "bad"), /valid/);
});
test("portable kit round trip preserves audio, rejects invalid values and duplicates", () => {
  const kit = defaultKit();
  kit.slots[0].audio = "data:audio/wav;base64,UklGRg==";
  kit.slots[0].filename = "kick.wav";
  assert.deepEqual(validateKit(JSON.parse(JSON.stringify(kit))), kit);
  const invalid = structuredClone(kit);
  invalid.slots[1].note = invalid.slots[0].note;
  assert.throws(() => validateKit(invalid));
  invalid.slots[1].note = 38;
  invalid.slots[0].volume = NaN;
  assert.throws(() => validateKit(invalid));
  assert.throws(() => validateKit({ version: 1, slots: [] }));
});
test("mute and solo apply to generated and custom slots", () => {
  const kit = defaultKit();
  assert.equal(audible(undefined, kit.slots), true);
  kit.slots[0].solo = true;
  assert.equal(audible(undefined, kit.slots), false);
  assert.equal(audible(kit.slots[0], kit.slots), true);
  kit.slots[0].mute = true;
  assert.equal(audible(kit.slots[0], kit.slots), false);
});
test("demo is a four bar percussion groove", () => {
  const song = demo();
  assert.equal(song.duration, 8);
  assert(
    song.hits.every(
      (h) =>
        h.channel === 9 &&
        h.time < song.duration &&
        h.velocity > 0 &&
        h.velocity <= 1,
    ),
  );
  assert(song.hits.some((h) => h.note === 36));
  assert(song.hits.some((h) => h.note === 38));
});
test("end-of-track rests preserve the loop length", () => {
  const song = parseMidi(
    midi(0, [[0, 153, 36, 100, 120, 137, 36, 0, 142, 8, 255, 47, 0]]),
    "rest.mid",
  );
  assert.equal(song.duration, 2);
});
