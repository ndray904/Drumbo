import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultKit, SLOT_NOTES, type Hit, type Song } from "../src/model.ts";
import {
  activeMapNotes,
  buildKitNoteMap,
  buildNoteMap,
} from "../src/note-map.ts";

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

test("kit note map keeps all 16 lanes in pad order and excludes other file notes", () => {
  const kit = defaultKit();
  const file = song([hit(1, 36), hit(0, 35), hit(0.5, 36), hit(0, 90)]);
  const originalFile = structuredClone(file);
  const originalKit = structuredClone(kit);
  const rows = buildKitNoteMap(file, kit, 9);
  assert.equal(rows.length, 16);
  assert.deepEqual(
    rows.map((row) => row.note),
    SLOT_NOTES,
  );
  assert.deepEqual(
    rows.map((row) => row.slotIndex),
    [...Array(16).keys()],
  );
  assert.deepEqual(
    rows[0].hits.map((event) => event.time),
    [0.5, 1],
  );
  assert.equal(rows[0].destination, "Pad 01 · Generated starter");
  assert.equal(rows[0].name, "Bass Drum 1");
  assert.equal(rows[0].source, "starter");
  assert.equal(rows[0].audible, true);
  assert(rows.slice(1).every((row) => row.hits.length === 0));
  assert(!rows.some((row) => row.note === 35 || row.note === 90));
  assert.deepEqual(file, originalFile);
  assert.deepEqual(kit, originalKit);
});

test("empty files and absent channels still display every kit sound", () => {
  const kit = defaultKit();
  for (const file of [song([]), song([hit(0, 36, 2)])]) {
    const rows = buildKitNoteMap(file, kit, 9);
    assert.equal(rows.length, 16);
    assert.deepEqual(
      rows.map((row) => row.note),
      SLOT_NOTES,
    );
    assert(rows.every((row) => row.hits.length === 0));
    assert(rows.every((row) => row.channels.length === 0));
    assert(rows.every((row) => row.name && row.destination && row.state));
    assert.deepEqual([...activeMapNotes(rows, 0, 2)], []);
  }
});

test("kit lanes remain stable when switching channels or displaying all channels", () => {
  const file = song([hit(1, 36, 2), hit(0, 36, 9), hit(0.25, 42, 2)]);
  const kit = defaultKit();
  const drums = buildKitNoteMap(file, kit, 9);
  const all = buildKitNoteMap(file, kit, -1);
  assert.deepEqual(
    drums.map((row) => row.note),
    all.map((row) => row.note),
  );
  assert.deepEqual(drums[0].channels, [9]);
  assert.equal(drums[2].hits.length, 0);
  assert.deepEqual(all[0].channels, [2, 9]);
  assert.deepEqual(
    all[0].hits.map((event) => event.time),
    [0, 1],
  );
  assert.deepEqual(all[2].channels, [2]);
  assert.deepEqual([...activeMapNotes(all, 0.3, 2)], [42]);
});

test("kit note lanes follow remapped slot order and preserve sample and silence details", () => {
  const kit = defaultKit();
  kit.slots[0].note = 35;
  kit.slots[0].audio = "data:audio/wav;base64,UklGRg==";
  kit.slots[0].filename = "Mapped kick.wav";
  kit.slots[0].mute = true;
  [kit.slots[0], kit.slots[1]] = [kit.slots[1], kit.slots[0]];
  const rows = buildKitNoteMap(song([hit(0, 35), hit(0.5, 36)]), kit, 9);
  assert.equal(rows.length, 16);
  assert.equal(rows[0].note, 38);
  assert.equal(rows[0].slotIndex, 0);
  assert.equal(rows[0].hits.length, 0);
  assert.equal(rows[1].note, 35);
  assert.equal(rows[1].slotIndex, 1);
  assert.equal(rows[1].hits.length, 1);
  assert.equal(rows[1].source, "sample");
  assert.equal(rows[1].destination, "Pad 02 · Mapped kick.wav");
  assert.equal(rows[1].state, "Muted");
  assert.equal(rows[1].audible, false);
  assert(!rows.some((row) => row.note === 36));
});
