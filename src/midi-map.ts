import type { Hit, Kit, Song } from "./model";
import { activeMapNotes, buildKitNoteMap, type NoteMapRow } from "./note-map";
import "./midi-map.css";

interface MapOptions {
  onAudition: (note: number) => void;
  onSeek: (time: number) => void;
  onTogglePlayback: () => void;
  onStop: () => void;
}

const timeLabel = (time: number) => {
  const tenths = Math.floor(Math.max(0, time) * 10);
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Keep dense files responsive while retaining a hit in every occupied time bin.
function visibleHits(hits: Hit[], duration: number, limit: number): Hit[] {
  if (hits.length <= limit) return hits;
  const bins = new Map<number, Hit>();
  for (const hit of hits) {
    const bin = Math.min(limit - 1, Math.floor((hit.time / duration) * limit));
    const previous = bins.get(bin);
    if (!previous || hit.velocity > previous.velocity) bins.set(bin, hit);
  }
  return [...bins.values()];
}

export class MidiMap {
  private rows: NoteMapRow[] = [];
  private rowNodes = new Map<number, HTMLElement>();
  private song?: Song;
  private duration = 1;
  private previousTime?: number;
  private previousPlaying = false;
  private wrapped = false;
  private playButton: HTMLButtonElement;
  private grid: HTMLElement;
  private ruler: HTMLElement;
  private playhead: HTMLElement;
  private seek: HTMLInputElement;
  private time: HTMLElement;

  constructor(
    private root: HTMLElement,
    private options: MapOptions,
  ) {
    root.innerHTML = `<div class="midi-map-heading"><h2 id="midi-map-title">MIDI note map</h2><div class="midi-map-controls"><button class="midi-map-toggle" type="button" aria-label="Play MIDI map">Play</button><button class="midi-map-stop" type="button" aria-label="Stop MIDI map">Stop</button></div></div>
      <div class="midi-map-ruler"><span>Sound</span><div class="midi-map-times"></div></div>
      <div class="midi-map-grid" aria-label="16 kit sounds and playback lanes"></div>
      <div class="midi-map-position"><input id="map-seek" aria-label="MIDI map position" type="range" min="0" max="1" step="0.001" value="0"><span class="midi-map-time">0:00.0 / 0:00.0</span></div>`;
    this.playButton = root.querySelector(".midi-map-toggle")!;
    this.playButton.onclick = () => this.options.onTogglePlayback();
    root.querySelector<HTMLButtonElement>(".midi-map-stop")!.onclick = () =>
      this.options.onStop();
    this.grid = root.querySelector(".midi-map-grid")!;
    this.ruler = root.querySelector(".midi-map-times")!;
    this.seek = root.querySelector("#map-seek")!;
    this.time = root.querySelector(".midi-map-time")!;
    this.playhead = element("div", "midi-map-playhead");
    this.playhead.setAttribute("aria-hidden", "true");
    this.seek.oninput = () => this.seekTo(Number(this.seek.value));
  }

  resetActivity() {
    this.previousTime = undefined;
    this.previousPlaying = false;
    this.wrapped = false;
  }

  private seekTo(time: number) {
    this.resetActivity();
    this.options.onSeek(time);
  }

  render(song: Song, kit: Kit, channel: number) {
    this.song = song;
    this.duration = Math.max(0.001, song.duration);
    this.rows = buildKitNoteMap(song, kit, channel);
    this.previousTime = undefined;
    this.previousPlaying = false;
    this.wrapped = false;
    this.rowNodes.clear();
    this.grid.replaceChildren();
    this.root.title = song.name;
    this.seek.max = String(this.duration);
    this.seek.disabled = song.hits.length === 0;
    this.ruler.replaceChildren();
    for (let index = 0; index <= 4; index++)
      this.ruler.append(
        element("span", "", timeLabel((this.duration * index) / 4)),
      );

    const markerLimit = Math.max(
      40,
      Math.min(640, Math.floor(6000 / this.rows.length)),
    );
    for (const row of this.rows) {
      const node = element("div", `midi-map-row map-source-${row.source}`);
      node.dataset.note = String(row.note);
      node.dataset.audible = String(row.audible);
      node.classList.toggle("is-unused", row.hits.length === 0);
      node.title = `${row.destination} · ${row.state}${row.hits.length ? "" : " · Not used in selected channel"}`;
      const audition = element(
        "button",
        "midi-map-note midi-map-name",
        row.name,
      );
      audition.type = "button";
      audition.setAttribute("aria-label", `Audition MIDI note ${row.note}`);
      audition.title = node.title;
      audition.onclick = () => this.options.onAudition(row.note);
      const track = element("div", "midi-map-track");
      track.setAttribute("aria-hidden", "true");
      track.title =
        "Click to seek. The Map position slider also supports keyboard seeking.";
      track.onclick = (event) => {
        const bounds = track.getBoundingClientRect();
        if (bounds.width)
          this.seekTo(
            Math.max(
              0,
              Math.min(1, (event.clientX - bounds.left) / bounds.width),
            ) * this.duration,
          );
      };
      for (const hit of visibleHits(row.hits, this.duration, markerLimit)) {
        const marker = element("span", "midi-map-hit");
        marker.style.left = `${Math.min(99.8, Math.max(0, (hit.time / this.duration) * 100))}%`;
        marker.style.opacity = String(0.25 + hit.velocity * 0.75);
        marker.title = `${timeLabel(hit.time)} · velocity ${Math.round(hit.velocity * 127)} · channel ${hit.channel + 1}`;
        track.append(marker);
      }
      node.append(audition, track);
      this.grid.append(node);
      this.rowNodes.set(row.note, node);
    }
    const overlay = element("div", "midi-map-playhead-layer");
    overlay.append(this.playhead);
    this.grid.append(overlay);
  }

  frame(time: number, playing: boolean, rate: number, loop: boolean) {
    if (!this.song) return;
    const position = Math.max(0, Math.min(this.duration, time));
    const recentWindow = 0.14 * Math.max(0.01, rate);
    if (
      loop &&
      playing &&
      this.previousPlaying &&
      this.previousTime !== undefined &&
      this.previousTime > this.duration - recentWindow &&
      position < recentWindow &&
      position < this.previousTime
    )
      this.wrapped = true;
    if (!loop || !playing || position >= recentWindow) this.wrapped = false;
    const active = playing
      ? activeMapNotes(
          this.rows,
          position,
          this.duration,
          recentWindow,
          this.wrapped,
        )
      : new Set<number>();
    for (const row of this.rows) {
      const node = this.rowNodes.get(row.note);
      if (!node) continue;
      const isActive = active.has(row.note);
      node.classList.toggle("is-active", isActive);
      node.classList.toggle("is-sounding", isActive && row.audible);
    }
    this.playhead.style.left = `${(position / this.duration) * 100}%`;
    this.seek.value = String(position);
    this.seek.setAttribute(
      "aria-valuetext",
      `${timeLabel(position)} of ${timeLabel(this.duration)}`,
    );
    this.time.textContent = `${timeLabel(position)} / ${timeLabel(this.duration)}`;
    const playLabel = playing ? "Pause" : "Play";
    if (this.playButton.textContent !== playLabel) {
      this.playButton.textContent = playLabel;
      this.playButton.setAttribute("aria-label", `${playLabel} MIDI map`);
    }
    this.root.classList.toggle("is-playing", playing);
    this.previousTime = position;
    this.previousPlaying = playing;
  }
}
