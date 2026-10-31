import { audible, type Kit, type Song } from "./model";
// Deterministic local starter percussion. No network or sample library required.
export function starter(ctx: BaseAudioContext, note: number): AudioBuffer {
  const cymbal = [42, 44, 46, 49, 51, 52, 53, 55, 57, 59, 80, 81].includes(
    note,
  );
  const kick = note === 35 || note === 36;
  const snare = [38, 39, 40].includes(note);
  const duration = kick
    ? 0.45
    : cymbal
      ? [42, 44, 80].includes(note)
        ? 0.12
        : 1.1
      : snare
        ? 0.24
        : 0.22;
  const b = ctx.createBuffer(
      1,
      Math.ceil(ctx.sampleRate * duration),
      ctx.sampleRate,
    ),
    out = b.getChannelData(0);
  let seed = note * 12345,
    prev = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / ctx.sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const noise = seed / 2147483648;
    const high = noise - prev;
    prev = noise;
    const freq = kick
      ? 48 + 105 * Math.exp(-t * 30)
      : [56, 67, 68, 80, 81].includes(note)
        ? 520 + (note - 35) * 25
        : 100 + (note - 35) * 13;
    const tone = Math.sin(
      2 *
        Math.PI *
        (kick ? 48 * t + (105 / 30) * (1 - Math.exp(-30 * t)) : freq * t),
    );
    out[i] =
      (kick
        ? tone
        : snare
          ? noise * 0.75 + tone * 0.25
          : cymbal
            ? high * 0.38
            : tone * 0.65 + noise * 0.25) *
      Math.exp(-t / (duration / 6)) *
      0.8;
  }
  return b;
}
export class Engine {
  ctx?: AudioContext;
  master?: GainNode;
  buffers = new Map<number, AudioBuffer>();
  custom = new Map<number, AudioBuffer>();
  active = new Set<AudioBufferSourceNode>();
  timer?: number;
  playing = false;
  position = 0;
  rate = 1;
  loop = true;
  private origin = 0;
  private cursor = 0;
  private cycle = 0;
  song!: Song;
  kit!: Kit;
  channel = 9;
  async activate() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
    }
    await this.ctx.resume();
  }
  async decode(audio: string) {
    if (!this.ctx) throw Error("Activate audio first.");
    const raw = atob(audio.split(",")[1]);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    return this.ctx.decodeAudioData(bytes.buffer);
  }
  hit(note: number, velocity = 1, when = this.ctx?.currentTime ?? 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const slot = this.kit.slots.find((s) => s.note === note);
    if (!audible(slot, this.kit.slots)) return;
    let buffer = this.custom.get(note) || this.buffers.get(note);
    if (!buffer) {
      buffer = starter(ctx, note);
      this.buffers.set(note, buffer);
    }
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = velocity * (slot?.volume ?? 1);
    source.connect(gain);
    gain.connect(this.master);
    source.onended = () => {
      this.active.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    this.active.add(source);
    source.start(when);
  }
  now() {
    if (!this.playing) return this.position;
    const elapsed =
      this.position + (this.ctx!.currentTime - this.origin) * this.rate;
    return this.loop
      ? elapsed % this.song.duration
      : Math.min(this.song.duration, elapsed);
  }
  play() {
    if (this.playing || !this.ctx) return;
    if (this.position >= this.song.duration) this.position = 0;
    this.origin = this.ctx.currentTime;
    this.cycle = 0;
    this.cursor = this.song.hits.findIndex((h) => h.time >= this.position);
    if (this.cursor < 0) this.cursor = this.song.hits.length;
    this.playing = true;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 20);
  }
  private tick() {
    if (!this.playing) return;
    const elapsed =
      this.position + (this.ctx!.currentTime - this.origin) * this.rate;
    const horizon = elapsed + 0.08 * this.rate;
    // Schedule across loop boundaries against the original audio clock to avoid drift.
    if (this.song.hits.length) {
      while (true) {
        if (this.cursor >= this.song.hits.length) {
          if (!this.loop) break;
          this.cursor = 0;
          this.cycle++;
        }
        const h = this.song.hits[this.cursor];
        const time = h.time + this.cycle * this.song.duration;
        if (time >= horizon) break;
        this.cursor++;
        if (
          (this.channel === -1 || h.channel === this.channel) &&
          h.note >= 35 &&
          h.note <= 81
        )
          this.hit(
            h.note,
            h.velocity,
            Math.max(
              this.ctx!.currentTime,
              this.origin + (time - this.position) / this.rate,
            ),
          );
      }
    }
    if (!this.loop && elapsed >= this.song.duration) {
      this.pause();
      this.position = 0;
    }
  }
  pause() {
    this.position = this.now();
    this.playing = false;
    clearInterval(this.timer);
    for (const s of this.active) s.stop();
    this.active.clear();
  }
  stop() {
    this.pause();
    this.position = 0;
  }
  seek(time: number) {
    const playing = this.playing;
    this.pause();
    this.position = Math.max(0, Math.min(this.song.duration, time));
    if (playing) this.play();
  }
  tempo(rate: number) {
    const playing = this.playing;
    this.pause();
    this.rate = rate;
    if (playing) this.play();
  }
}
