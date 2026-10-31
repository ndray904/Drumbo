import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultKit, type Hit, type Song } from "../src/model.ts";
import { activeMapNotes, buildNoteMap } from "../src/note-map.ts";

function song(hits: Hit[]): Song {
  return {
    name: "Mapped file.mid",
    hits,
    duration: 2,
    bpm: 120,
    tempos: 1,
    channels: [...new Set(hits.map((hit) => hit.channel))],
    selected: 9,
  };
}
const hit = (time: number, note: number, channel = 9): Hit => ({
  time,
  note,
  channel,
  velocity: 0.8,
});

test("note map groups a file's used notes and follows the selected MIDI channel", () => {
  const file = song([
    hit(1, 36),
    hit(0.5, 60, 2),
    hit(0, 36),
    hit(0, 42),
    hit(0.75, 36, 2),
  ]);
  const originalOrder = [...file.hits];
  const selected = buildNoteMap(file, defaultKit(), 9);
  assert.deepEqual(
    selected.map((row) => row.note),
    [42, 36],
  );
  assert.deepEqual(
    selected[1].hits.map((event) => event.time),
    [0, 1],
  );
  assert.deepEqual(selected[1].channels, [9]);
  assert.equal(selected[1].pitch, "C2");
  assert.equal(selected[1].name, "Bass Drum 1");
  assert.equal(selected[1].slotIndex, 0);
  assert.equal(selected[1].destination, "Pad 01 · Generated starter");
  const all = buildNoteMap(file, defaultKit(), -1);
  assert.deepEqual(
    all.map((row) => row.note),
    [60, 42, 36],
  );
  assert.equal(all[0].pitch, "C4");
  assert.deepEqual(all[2].channels, [2, 9]);
  assert.deepEqual(
    all[2].hits.map((event) => event.time),
    [0, 0.75, 1],
  );
  assert.deepEqual(
    file.hits,
    originalOrder,
    "building a map must not reorder the song",
  );
  assert.deepEqual(buildNoteMap(file, defaultKit(), 5), []);
});

test("note map distinguishes generated fallbacks from notes the player will skip", () => {
  const rows = buildNoteMap(
    song([hit(0, 34), hit(0, 35), hit(0, 81), hit(0, 82)]),
    defaultKit(),
    9,
  );
  const byNote = new Map(rows.map((row) => [row.note, row]));
  for (const note of [35, 81]) {
    assert.equal(byNote.get(note)!.source, "fallback");
    assert.equal(byNote.get(note)!.audible, true);
    assert.equal(byNote.get(note)!.slotIndex, -1);
    assert.equal(
      byNote.get(note)!.destination,
      "No kit pad · Generated fallback",
    );
  }
  for (const note of [34, 82]) {
    assert.equal(byNote.get(note)!.source, "unsupported");
    assert.equal(byNote.get(note)!.audible, false);
    assert.equal(
      byNote.get(note)!.destination,
      "Not played · Outside GM range",
    );
  }
});

test("mapping refresh reflects sample loading, reassigned pads, mute, solo, and zero volume", () => {
  const kit = defaultKit();
  const file = song([hit(0, 35), hit(0, 36), hit(0, 38)]);
  kit.slots[0].audio = "data:audio/wav;base64,UklGRg==";
  kit.slots[0].filename = "My kick.wav";
  let rows = buildNoteMap(file, kit, 9);
  assert.equal(rows.find((row) => row.note === 36)!.source, "sample");
  assert.equal(
    rows.find((row) => row.note === 36)!.destination,
    "Pad 01 · My kick.wav",
  );
  kit.slots[0].note = 35;
  rows = buildNoteMap(file, kit, 9);
  assert.equal(rows.find((row) => row.note === 35)!.source, "sample");
  assert.equal(rows.find((row) => row.note === 36)!.source, "fallback");
  kit.slots[0].solo = true;
  rows = buildNoteMap(file, kit, 9);
  assert.equal(rows.find((row) => row.note === 35)!.audible, true);
  for (const note of [36, 38]) {
    assert.equal(rows.find((row) => row.note === note)!.audible, false);
    assert.match(
      rows.find((row) => row.note === note)!.state,
      /Another pad is solo/,
    );
  }
  kit.slots[0].mute = true;
  assert.equal(
    buildNoteMap(file, kit, 9).find((row) => row.note === 35)!.state,
    "Muted",
  );
  kit.slots[0].mute = false;
  kit.slots[0].volume = 0;
  assert.equal(
    buildNoteMap(file, kit, 9).find((row) => row.note === 35)!.state,
    "Volume 0",
  );
  assert.equal(
    buildNoteMap(file, kit, 9).find((row) => row.note === 35)!.audible,
    false,
  );
});

test("MIDI activity includes simultaneous and silenced notes without highlighting future hits", () => {
  const kit = defaultKit();
  kit.slots[0].mute = true;
  const rows = buildNoteMap(
    song([hit(0, 36), hit(0, 38), hit(0.15, 42), hit(0, 90)]),
    kit,
    9,
  );
  assert.deepEqual([...activeMapNotes(rows, 0, 2)].sort(), [36, 38, 90]);
  assert.deepEqual([...activeMapNotes(rows, 0.1, 2)].sort(), [36, 38, 90]);
  assert.deepEqual([...activeMapNotes(rows, 0.15, 2)], [42]);
  assert.deepEqual([...activeMapNotes(rows, 0.5, 2)], []);
  assert.deepEqual([...activeMapNotes(rows, 0.2, 2, 0.02)], []);
  assert.deepEqual(
    [...activeMapNotes(rows, 0.2, 2, 0.2)].sort(),
    [36, 38, 42, 90],
  );
});

test("loop-tail highlights require explicit wrap and expire across the loop boundary", () => {
  const rows = buildNoteMap(
    song([hit(0.02, 36), hit(1.95, 38)]),
    defaultKit(),
    9,
  );
  assert.deepEqual(
    [...activeMapNotes(rows, 0, 2)],
    [],
    "initial playback must not flash the preceding tail",
  );
  assert.deepEqual([...activeMapNotes(rows, 0.03, 2)], [36]);
  assert.deepEqual(
    [...activeMapNotes(rows, 0.03, 2, 0.14, true)].sort(),
    [36, 38],
  );
  assert.deepEqual([...activeMapNotes(rows, 0.15, 2, 0.14, true)], [36]);
  assert.deepEqual([...activeMapNotes(rows, 1.96, 2)], [38]);
  assert.deepEqual([...activeMapNotes(rows, -1, 2)], []);
  assert.deepEqual([...activeMapNotes(rows, 0, 0)], []);
  assert.deepEqual([...activeMapNotes(rows, NaN, 2)], []);
});
