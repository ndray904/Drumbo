import type { Hit, Kit, Song } from "./model";
import { activeMapNotes, buildNoteMap, type NoteMapRow } from "./note-map";
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
  private file: HTMLElement;
  private summary: HTMLElement;
  private mode: HTMLElement;
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
    root.innerHTML = `<div class="midi-map-heading"><div><span class="eyebrow">SEE YOUR GROOVE</span><h2 id="midi-map-title">MIDI note map</h2></div><div class="midi-map-controls"><span class="midi-map-mode">Ready</span><button class="midi-map-toggle" type="button" aria-label="Play MIDI map">Play</button><button class="midi-map-stop" type="button" aria-label="Stop MIDI map">Stop</button></div></div>
      <p class="midi-map-file"></p>
      <div class="midi-map-meta"><p id="midi-map-summary"></p><div class="midi-map-legend" aria-label="Mapping legend"><span class="map-key-pad">Kit pad</span><span class="map-key-fallback">Generated fallback</span><span class="map-key-unsupported">Not played</span></div></div>
      <p class="midi-map-help">Tap a note to audition its sound. Follow the playhead or click a lane to seek.</p>
      <div class="midi-map-ruler"><span>NOTE / SOUND</span><div class="midi-map-times"></div></div>
      <div class="midi-map-scroll" tabindex="0" aria-label="MIDI notes and playback lanes"><div class="midi-map-grid"></div></div>
      <div class="midi-map-position"><label for="map-seek">Map position</label><input id="map-seek" type="range" min="0" max="1" step="0.001" value="0"><span class="midi-map-time">0:00.0 / 0:00.0</span></div>
      <p class="midi-map-footnote">Lane flashes show MIDI activity. Audio follows your kit’s mute, solo and volume settings.</p>`;
    this.file = root.querySelector(".midi-map-file")!;
    this.summary = root.querySelector("#midi-map-summary")!;
    this.mode = root.querySelector(".midi-map-mode")!;
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
    this.rows = buildNoteMap(song, kit, channel);
    this.previousTime = undefined;
    this.previousPlaying = false;
    this.wrapped = false;
    this.rowNodes.clear();
    this.grid.replaceChildren();
    this.file.textContent = song.name;
    const hitCount = this.rows.reduce((sum, row) => sum + row.hits.length, 0);
    const channelLabel =
      channel === -1 ? "All channels" : `Channel ${channel + 1}`;
    this.summary.textContent = `${this.rows.length} ${this.rows.length === 1 ? "note" : "notes"} · ${hitCount} ${hitCount === 1 ? "hit" : "hits"} · ${channelLabel}`;
    this.seek.max = String(this.duration);
    this.seek.disabled = this.rows.length === 0;
    this.ruler.replaceChildren();
    for (let index = 0; index <= 4; index++)
      this.ruler.append(
        element("span", "", timeLabel((this.duration * index) / 4)),
      );

    if (!this.rows.length) {
      const empty = element("div", "midi-map-empty");
      empty.append(
        element("strong", "", "No notes in this channel"),
        element(
          "p",
          "",
          "Choose another channel, load a MIDI file, or play the demo groove.",
        ),
      );
      this.grid.append(empty);
      this.frame(0, false, 1, false);
      return;
    }

    const markerLimit = Math.max(
      40,
      Math.min(640, Math.floor(6000 / this.rows.length)),
    );
    for (const row of this.rows) {
      const node = element("div", `midi-map-row map-source-${row.source}`);
      node.dataset.note = String(row.note);
      node.dataset.audible = String(row.audible);
      const label = element("div", "midi-map-label");
      const audition = element("button", "midi-map-note");
      audition.type = "button";
      audition.setAttribute("aria-label", `Audition MIDI note ${row.note}`);
      audition.disabled = row.source === "unsupported";
      audition.title =
        row.source === "unsupported"
          ? row.destination
          : `Audition ${row.name}; ${row.state}`;
      audition.append(
        element("span", "midi-map-number", `${row.note} / ${row.pitch}`),
        element("strong", "midi-map-name", row.name),
      );
      audition.onclick = () => this.options.onAudition(row.note);
      const destination = element(
        "span",
        "midi-map-destination",
        row.destination,
      );
      const detail = element("span", "midi-map-detail");
      detail.append(
        element(
          "span",
          "midi-map-hit-count",
          `${row.hits.length} ${row.hits.length === 1 ? "hit" : "hits"}`,
        ),
        element("span", "midi-map-state", row.state),
      );
      label.append(audition, destination, detail);
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
      node.append(label, track);
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
    const mode = playing ? "Playing" : position > 0 ? "Paused" : "Ready";
    if (this.mode.textContent !== mode) this.mode.textContent = mode;
    this.root.classList.toggle("is-playing", playing);
    this.previousTime = position;
    this.previousPlaying = playing;
  }
}
