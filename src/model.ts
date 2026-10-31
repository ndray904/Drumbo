import * as MidiPackage from "@tonejs/midi";
// Support both the Node CommonJS entry and Vite’s optimized browser entry.
const Midi =
  MidiPackage.Midi ??
  (MidiPackage as unknown as { default: typeof MidiPackage }).default.Midi;
export const GM_NAMES = [
  "Acoustic Bass Drum",
  "Bass Drum 1",
  "Side Stick",
  "Acoustic Snare",
  "Hand Clap",
  "Electric Snare",
  "Low Floor Tom",
  "Closed Hi-Hat",
  "High Floor Tom",
  "Pedal Hi-Hat",
  "Low Tom",
  "Open Hi-Hat",
  "Low-Mid Tom",
  "Hi-Mid Tom",
  "Crash Cymbal 1",
  "High Tom",
  "Ride Cymbal 1",
  "Chinese Cymbal",
  "Ride Bell",
  "Tambourine",
  "Splash Cymbal",
  "Cowbell",
  "Crash Cymbal 2",
  "Vibraslap",
  "Ride Cymbal 2",
  "Hi Bongo",
  "Low Bongo",
  "Mute Hi Conga",
  "Open Hi Conga",
  "Low Conga",
  "High Timbale",
  "Low Timbale",
  "High Agogo",
  "Low Agogo",
  "Cabasa",
  "Maracas",
  "Short Whistle",
  "Long Whistle",
  "Short Guiro",
  "Long Guiro",
  "Claves",
  "Hi Wood Block",
  "Low Wood Block",
  "Mute Cuica",
  "Open Cuica",
  "Mute Triangle",
  "Open Triangle",
];
export const gmName = (note: number) => GM_NAMES[note - 35] ?? `Note ${note}`;
export const SLOT_NOTES = [
  36, 38, 42, 46, 49, 51, 37, 39, 41, 43, 45, 47, 48, 50, 54, 56,
];
export interface Hit {
  time: number;
  note: number;
  velocity: number;
  channel: number;
}
export interface Song {
  name: string;
  hits: Hit[];
  duration: number;
  bpm: number;
  tempos: number;
  channels: number[];
  selected: number;
}
export function parseMidi(data: ArrayBuffer, name: string): Song {
  const bytes = new Uint8Array(data);
  if (bytes.length < 14 || String.fromCharCode(...bytes.slice(0, 4)) !== "MThd")
    throw Error("Choose a valid MIDI file.");
  const view = new DataView(data);
  if (view.getUint16(8) > 1)
    throw Error("Only MIDI formats 0 and 1 are supported.");
  if (view.getUint16(12) & 0x8000)
    throw Error(
      "SMPTE time division is not supported. Use a beat-based MIDI file.",
    );
  const midi = new Midi(data);
  const hits: Hit[] = [];
  for (const track of midi.tracks)
    for (const n of track.notes)
      hits.push({
        time: n.time,
        note: n.midi,
        velocity: n.velocity,
        channel: track.channel,
      });
  hits.sort((a, b) => a.time - b.time);
  const channels = [...new Set(hits.map((h) => h.channel))].sort(
    (a, b) => a - b,
  );
  return {
    name,
    hits,
    duration: midi.tracks.reduce(
      (duration, track) =>
        Math.max(
          duration,
          midi.header.ticksToSeconds(track.endOfTrackTicks ?? 0),
        ),
      Math.max(midi.duration, 0.5),
    ),
    bpm: midi.header.tempos[0]?.bpm ?? 120,
    tempos: midi.header.tempos.length,
    channels,
    selected: channels.includes(9) ? 9 : (channels[0] ?? 9),
  };
}
export function demo(): Song {
  const hits: Hit[] = [];
  for (let step = 0; step < 64; step++) {
    const time = step * 0.125;
    hits.push({
      time,
      note: step % 8 === 7 ? 46 : 42,
      velocity: step % 2 ? 0.46 : 0.72,
      channel: 9,
    });
    if (step % 8 === 0 || step % 16 === 10)
      hits.push({ time, note: 36, velocity: 0.95, channel: 9 });
    if (step % 8 === 4)
      hits.push({ time, note: 38, velocity: 0.86, channel: 9 });
  }
  return {
    name: "Pocket groove · 4 bars",
    hits,
    duration: 8,
    bpm: 120,
    tempos: 1,
    channels: [9],
    selected: 9,
  };
}
export interface Slot {
  note: number;
  volume: number;
  mute: boolean;
  solo: boolean;
  audio?: string;
  filename?: string;
}
export interface Kit {
  version: 1;
  name: string;
  slots: Slot[];
}
export function defaultKit(): Kit {
  return {
    version: 1,
    name: "Starter kit",
    slots: SLOT_NOTES.map((note) => ({
      note,
      volume: 1,
      mute: false,
      solo: false,
    })),
  };
}
export function audible(slot: Slot | undefined, slots: Slot[]) {
  return !slot?.mute && (!slots.some((s) => s.solo) || !!slot?.solo);
}
export function validateKit(value: unknown): Kit {
  const k = value as Kit;
  if (
    !k ||
    k.version !== 1 ||
    typeof k.name !== "string" ||
    !Array.isArray(k.slots) ||
    k.slots.length !== 16
  )
    throw Error("Expected a Drumbo version 1 kit with 16 slots.");
  const used = new Set<number>();
  for (const s of k.slots) {
    if (
      !Number.isInteger(s.note) ||
      s.note < 35 ||
      s.note > 81 ||
      used.has(s.note) ||
      !Number.isFinite(s.volume) ||
      s.volume < 0 ||
      s.volume > 2 ||
      typeof s.mute !== "boolean" ||
      typeof s.solo !== "boolean" ||
      (s.audio !== undefined &&
        (typeof s.audio !== "string" ||
          !/^data:audio\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/.test(s.audio)))
    )
      throw Error("Invalid kit slot or duplicate GM note.");
    used.add(s.note);
  }
  return structuredClone(k);
}
