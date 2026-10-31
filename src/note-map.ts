import { audible, gmName, type Hit, type Kit, type Song } from "./model";

export interface NoteMapRow {
  note: number;
  name: string;
  pitch: string;
  hits: Hit[];
  channels: number[];
  slotIndex: number;
  source: "sample" | "starter" | "fallback" | "unsupported";
  destination: string;
  audible: boolean;
  state: string;
}

const PITCHES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

function groupHits(song: Song, channel: number): Map<number, Hit[]> {
  const notes = new Map<number, Hit[]>();
  for (const hit of song.hits) {
    if (channel !== -1 && hit.channel !== channel) continue;
    const hits = notes.get(hit.note);
    if (hits) hits.push(hit);
    else notes.set(hit.note, [hit]);
  }

  for (const hits of notes.values()) hits.sort((a, b) => a.time - b.time);
  return notes;
}

function describeNote(
  note: number,
  hits: Hit[],
  kit: Kit,
  slotIndex = kit.slots.findIndex((slot) => slot.note === note),
): NoteMapRow {
  const supported = note >= 35 && note <= 81;
  if (!supported) slotIndex = -1;
  const slot = kit.slots[slotIndex];
  const source: NoteMapRow["source"] = !supported
    ? "unsupported"
    : !slot
      ? "fallback"
      : slot.audio
        ? "sample"
        : "starter";
  const destination = !supported
    ? "Not played · Outside GM range"
    : !slot
      ? "No kit pad · Generated fallback"
      : `Pad ${String(slotIndex + 1).padStart(2, "0")} · ${
          source === "sample"
            ? slot.filename || "Custom sample"
            : "Generated starter"
        }`;
  const canPlay =
    supported && audible(slot, kit.slots) && (slot?.volume ?? 1) > 0;
  const state = !supported
    ? "Outside GM range"
    : slot?.mute
      ? "Muted"
      : slot?.volume === 0
        ? "Volume 0"
        : !canPlay
          ? "Silent · Another pad is solo"
          : "Audible";
  return {
    note,
    name: gmName(note),
    pitch: `${PITCHES[note % 12]}${Math.floor(note / 12) - 1}`,
    hits,
    channels: [...new Set(hits.map((hit) => hit.channel))].sort(
      (a, b) => a - b,
    ),
    slotIndex,
    source,
    destination,
    audible: canPlay,
    state,
  };
}

/** Describe only notes used by the selected channel, using the current kit. */
export function buildNoteMap(
  song: Song,
  kit: Kit,
  channel: number,
): NoteMapRow[] {
  return [...groupHits(song, channel).entries()]
    .sort(([a], [b]) => b - a)
    .map(([note, hits]) => describeNote(note, hits, kit));
}

/** Keep the 16 kit lanes in pad order, even when a lane has no MIDI events. */
export function buildKitNoteMap(
  song: Song,
  kit: Kit,
  channel: number,
): NoteMapRow[] {
  const notes = groupHits(song, channel);
  return kit.slots
    .slice(0, 16)
    .map((slot, slotIndex) =>
      describeNote(slot.note, notes.get(slot.note) ?? [], kit, slotIndex),
    );
}

/** Last hit at or before the playhead, without scanning an entire lane per frame. */
function lastHitAt(hits: Hit[], time: number): number {
  let low = 0;
  let high = hits.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (hits[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/**
 * MIDI activity, including notes currently silenced by the kit. The caller only
 * enables wrap after an actual loop boundary, avoiding false tail flashes when
 * first starting or seeking to the beginning. Pass a rate-scaled window to keep
 * the highlight's duration steady in real time at different playback tempos.
 */
export function activeMapNotes(
  rows: NoteMapRow[],
  time: number,
  duration: number,
  windowSeconds = 0.14,
  wrap = false,
): Set<number> {
  const active = new Set<number>();
  if (
    !Number.isFinite(time) ||
    !Number.isFinite(duration) ||
    !Number.isFinite(windowSeconds) ||
    duration <= 0 ||
    time < 0 ||
    time > duration ||
    windowSeconds < 0
  )
    return active;

  const start = time - windowSeconds;
  for (const row of rows) {
    const current = lastHitAt(row.hits, time);
    if (current >= 0 && row.hits[current].time >= Math.max(0, start)) {
      active.add(row.note);
      continue;
    }
    if (wrap && start < 0) {
      const tail = lastHitAt(row.hits, duration);
      if (tail >= 0 && row.hits[tail].time >= duration + start)
        active.add(row.note);
    }
  }
  return active;
}
