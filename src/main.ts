import "./style.css";
import {
  demo,
  parseMidi,
  defaultKit,
  gmName,
  GM_NAMES,
  validateKit,
  type Kit,
} from "./model";
import { Engine } from "./audio";
import { MidiMap } from "./midi-map";
import { kits, saveKit } from "./storage";
const engine = new Engine();
engine.song = demo();
engine.kit = defaultKit();
engine.channel = 9;
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const app = $("app");
app.innerHTML = `<header><a class="brand" href="#">drumbo<span>●</span></a><span class="tag">THE LOCAL DRUM LAB</span><button id="activate">Activate audio</button></header>
<main><section class="intro"><div><span class="eyebrow">MIDI IN. YOUR SOUND OUT.</span><h1>Find your<br><em>pocket.</em></h1><p>Drop a groove. Build a kit. Make it yours.<br>Everything happens right here, in your browser.</p></div><div id="drop" class="drop"><span class="drop-icon">↥</span><h2>Bring your own groove</h2><p>Drop a MIDI file here, or choose one below</p><label class="primary file">Choose MIDI<input id="midi" type="file" accept=".mid,.midi,audio/midi"></label><small>MIDI formats 0 & 1 · No uploads. Ever.</small><button id="demo" class="text">↗ Load demo groove</button></div></section>
<section class="transport panel"><div class="song"><span class="eyebrow">NOW IN THE POCKET</span><h2 id="song"></h2><span id="info"></span></div><div class="playback"><button id="stop" aria-label="Stop">■</button><button id="play" class="play" aria-label="Play">▶</button><label class="check"><input id="loop" type="checkbox" checked> Loop</label></div><div class="timeline"><span id="time">0:00</span><input id="seek" aria-label="Seek" type="range" min="0" max="8" step=".01" value="0"><span id="duration">0:08</span></div><div class="transport-options"><label>CHANNEL <select id="channel"></select></label><label>TEMPO <input id="tempo" type="number" min="20" max="400" value="120"> BPM</label><label>MASTER <input id="master" aria-label="Master volume" type="range" min="0" max="1" step=".01" value=".7"></label></div></section>
<section id="midi-map" class="panel midi-map" aria-labelledby="midi-map-title"></section>
<section class="kit-header"><div><span class="eyebrow">16 PADS. ENDLESS POSSIBILITIES.</span><h2>Your drum kit <span class="pill">GM</span></h2></div><button id="check">▷ GM sound check</button></section>
<div class="kit-tools"><label>Kit name <input id="kitname" value="Starter kit" maxlength="80"></label><button id="save">Save locally</button><select id="saved" aria-label="Saved kits"><option value="">Load saved kit…</option></select><button id="export">Export JSON ↗</button><label class="file button">Import JSON<input id="import" type="file" accept=".json,application/json"></label></div>
<section id="pads" class="pads" aria-label="Editable sample slots"></section>
<details class="panel gm"><summary>All 47 General MIDI percussion sounds <span>35–81</span></summary><p>Tap to audition. Notes outside your 16 slots use locally generated starter sounds.</p><div id="gm"></div></details>
<footer><span>● 100% local processing</span><span>Samples, kits & grooves stay on your device.</span><span>DRUMBO / BROWSER EDITION</span></footer></main><div id="status" role="status" aria-live="polite">Ready. Load a MIDI or play the demo groove.</div>`;
const status = (message: string) => {
  $("status").textContent = message;
};
const safe = (action: () => Promise<void> | void) => {
  try {
    Promise.resolve(action()).catch((e) =>
      status(e instanceof Error ? e.message : String(e)),
    );
  } catch (e) {
    status(e instanceof Error ? e.message : String(e));
  }
};
const midiMap = new MidiMap($("midi-map"), {
  onAudition: (note) =>
    safe(async () => {
      await activate();
      engine.hit(note);
      status(`${note} · ${gmName(note)} · current kit settings apply.`);
    }),
  onSeek: (time) => engine.seek(time),
  onTogglePlayback: () => $("play").click(),
  onStop: () => $("stop").click(),
});
function refreshMap() {
  midiMap.render(engine.song, engine.kit, engine.channel);
}
const format = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
async function activate() {
  await engine.activate();
  engine.master!.gain.value = Number($<HTMLInputElement>("master").value);
  $("activate").textContent = "● Audio active";
}
function songUI() {
  $("song").textContent = engine.song.name;
  $("info").textContent =
    `${engine.song.hits.length} hits · ${engine.song.tempos || 1} tempo section${engine.song.tempos > 1 ? "s" : ""} · ${engine.song.channels.length} channel${engine.song.channels.length !== 1 ? "s" : ""}`;
  const ch = $<HTMLSelectElement>("channel");
  ch.replaceChildren();
  for (const [value, label] of [
    [-1, "All channels"],
    ...engine.song.channels.map((c) => [
      c,
      `Channel ${c + 1}${c === 9 ? " · drums" : ""}`,
    ]),
  ] as [number, string][]) {
    ch.add(new Option(label, String(value)));
  }
  ch.value = String(engine.channel);
  $<HTMLInputElement>("tempo").value = String(Math.round(engine.song.bpm));
  $<HTMLInputElement>("seek").max = String(engine.song.duration);
  $("duration").textContent = format(engine.song.duration);
  refreshMap();
}
function pads() {
  const root = $("pads");
  root.replaceChildren();
  engine.kit.slots.forEach((slot, index) => {
    const card = document.createElement("article");
    card.className = "pad";
    card.innerHTML = `<div class="pad-top"><span>${String(index + 1).padStart(2, "0")}</span><span class="sample-state"></span></div><button class="strike"><strong></strong><small></small></button><select aria-label="GM mapping for slot ${index + 1}"></select><div class="pad-controls"><button class="mute" aria-label="Mute slot ${index + 1}">M</button><button class="solo" aria-label="Solo slot ${index + 1}">S</button><input type="range" min="0" max="2" step=".01" aria-label="Volume for slot ${index + 1}"></div><div class="sample-tools"><label class="file">＋ Load sample<input type="file" accept="audio/*"></label><button class="reset" aria-label="Reset sample for slot ${index + 1}">↺</button></div>`;
    card.querySelector("strong")!.textContent = gmName(slot.note);
    card.querySelector(".strike small")!.textContent =
      slot.filename || "Generated starter";
    card.querySelector(".sample-state")!.textContent = slot.audio
      ? "SAMPLE"
      : "SYNTH";
    const select = card.querySelector("select")!;
    GM_NAMES.forEach((n, i) => {
      const o = new Option(`${i + 35} · ${n}`, String(i + 35));
      o.disabled = engine.kit.slots.some(
        (s) => s !== slot && s.note === i + 35,
      );
      select.add(o);
    });
    select.value = String(slot.note);
    select.onchange = () => {
      engine.pause();
      const buffer = engine.custom.get(slot.note);
      engine.custom.delete(slot.note);
      slot.note = Number(select.value);
      if (buffer) engine.custom.set(slot.note, buffer);
      pads();
    };
    card.querySelector<HTMLButtonElement>(".strike")!.onpointerdown = (
      event,
    ) => {
      event.preventDefault();
      safe(async () => {
        await activate();
        engine.hit(slot.note);
        card.classList.add("hit");
        setTimeout(() => card.classList.remove("hit"), 140);
      });
    };
    card.querySelector<HTMLButtonElement>(".strike")!.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        safe(async () => {
          await activate();
          engine.hit(slot.note);
        });
      }
    };
    const mute = card.querySelector<HTMLButtonElement>(".mute")!,
      solo = card.querySelector<HTMLButtonElement>(".solo")!;
    mute.classList.toggle("on", slot.mute);
    solo.classList.toggle("on", slot.solo);
    mute.setAttribute("aria-pressed", String(slot.mute));
    solo.setAttribute("aria-pressed", String(slot.solo));
    mute.onclick = () => {
      slot.mute = !slot.mute;
      pads();
    };
    solo.onclick = () => {
      slot.solo = !slot.solo;
      pads();
    };
    const volume = card.querySelector<HTMLInputElement>("input[type=range]")!;
    volume.value = String(slot.volume);
    volume.oninput = () => {
      const wasSilent = slot.volume === 0;
      slot.volume = Number(volume.value);
      if (wasSilent !== (slot.volume === 0)) refreshMap();
    };
    card.querySelector<HTMLInputElement>("input[type=file]")!.onchange = (
      event,
    ) =>
      safe(async () => {
        await activate();
        const f = (event.target as HTMLInputElement).files?.[0];
        if (!f) return;
        if (f.size > 30 * 1024 * 1024)
          throw Error("Choose an audio sample smaller than 30 MB.");
        const audio = await dataURL(f);
        const buffer = await engine.decode(audio);
        engine.custom.set(slot.note, buffer);
        slot.audio = audio;
        slot.filename = f.name;
        pads();
        status(`Loaded ${f.name}`);
      });
    card.querySelector<HTMLButtonElement>(".reset")!.onclick = () => {
      engine.custom.delete(slot.note);
      delete slot.audio;
      delete slot.filename;
      pads();
    };
    root.append(card);
  });
  refreshMap();
}
function dataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result);
      resolve(raw.replace(/^data:[^;]*;/, "data:audio/octet-stream;"));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
async function loadMidi(file: File) {
  const song = parseMidi(await file.arrayBuffer(), file.name);
  stopCheck();
  engine.stop();
  engine.song = song;
  engine.channel = song.selected;
  engine.rate = 1;
  songUI();
  status(`Loaded ${file.name}. Channel ${song.selected + 1} selected.`);
}
$("activate").onclick = () => safe(activate);
$("play").onclick = () =>
  safe(async () => {
    stopCheck();
    await activate();
    if (engine.playing) engine.pause();
    else engine.play();
  });
$("stop").onclick = () => {
  stopCheck();
  engine.stop();
};
$<HTMLInputElement>("loop").onchange = (e) => {
  const time = engine.now();
  engine.loop = (e.target as HTMLInputElement).checked;
  engine.seek(time);
};
$<HTMLInputElement>("seek").oninput = (e) => {
  midiMap.resetActivity();
  engine.seek(Number((e.target as HTMLInputElement).value));
};
$<HTMLSelectElement>("channel").onchange = (e) => {
  const position = engine.now();
  engine.channel = Number((e.target as HTMLSelectElement).value);
  engine.seek(position);
  refreshMap();
};
$<HTMLInputElement>("tempo").onchange = (e) => {
  const bpm = Number((e.target as HTMLInputElement).value);
  if (bpm >= 20 && bpm <= 400) engine.tempo(bpm / engine.song.bpm);
  else
    (e.target as HTMLInputElement).value = String(
      Math.round(engine.song.bpm * engine.rate),
    );
};
$<HTMLInputElement>("master").oninput = (e) => {
  if (engine.master)
    engine.master.gain.value = Number((e.target as HTMLInputElement).value);
};
$<HTMLInputElement>("midi").onchange = (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) safe(() => loadMidi(file));
};
const drop = $("drop");
drop.ondragover = (e) => {
  e.preventDefault();
  drop.classList.add("drag");
};
drop.ondragleave = () => drop.classList.remove("drag");
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove("drag");
  const f = e.dataTransfer?.files[0];
  if (f) safe(() => loadMidi(f));
};
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
$("demo").onclick = () => {
  engine.stop();
  engine.song = demo();
  engine.channel = 9;
  engine.rate = 1;
  songUI();
  status("Demo groove loaded.");
};
async function refreshKits() {
  const select = $<HTMLSelectElement>("saved");
  select.replaceChildren(new Option("Load saved kit…", ""));
  for (const k of await kits()) select.add(new Option(k.name, k.name));
}
async function applyKit(kit: Kit) {
  await activate();
  const decoded = new Map<number, AudioBuffer>();
  for (const slot of kit.slots)
    if (slot.audio) decoded.set(slot.note, await engine.decode(slot.audio));
  engine.pause();
  engine.kit = kit;
  engine.custom = decoded;
  $<HTMLInputElement>("kitname").value = kit.name;
  pads();
  status(`Loaded kit: ${kit.name}`);
}
$("save").onclick = () =>
  safe(async () => {
    engine.kit.name =
      $<HTMLInputElement>("kitname").value.trim() || "Untitled kit";
    await saveKit(engine.kit);
    await refreshKits();
    status(`Saved “${engine.kit.name}” on this device.`);
  });
$<HTMLSelectElement>("saved").onchange = (e) => {
  const name = (e.target as HTMLSelectElement).value;
  if (name)
    safe(async () => {
      await activate();
      const kit = (await kits()).find((k) => k.name === name);
      if (kit) await applyKit(kit);
    });
};
$("export").onclick = () => {
  engine.kit.name =
    $<HTMLInputElement>("kitname").value.trim() || "Untitled kit";
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(engine.kit)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "drumbo-kit.json";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status("Kit exported with embedded sample audio.");
};
$<HTMLInputElement>("import").onchange = (e) =>
  safe(async () => {
    await activate();
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (f.size > 100 * 1024 * 1024)
      throw Error("Kit JSON must be under 100 MB.");
    await applyKit(validateKit(JSON.parse(await f.text())));
  });
let checkTimers: number[] = [];
let checking = false;
function stopCheck() {
  checkTimers.forEach(clearTimeout);
  checkTimers = [];
  checking = false;
  $("check").textContent = "▷ GM sound check";
}
$("check").onclick = () =>
  safe(async () => {
    await activate();
    if (checking) {
      stopCheck();
      engine.pause();
      return;
    }
    engine.pause();
    checking = true;
    $("check").textContent = "■ Stop sound check";
    status("Checking all 47 GM notes; kit mute and solo settings apply.");
    GM_NAMES.forEach((name, i) =>
      checkTimers.push(
        window.setTimeout(() => {
          engine.hit(i + 35, 0.8);
          status(`${i + 35} · ${name}`);
          if (i === 46) stopCheck();
        }, i * 350),
      ),
    );
  });
GM_NAMES.forEach((name, i) => {
  const b = document.createElement("button");
  b.textContent = `${i + 35} ${name}`;
  b.onclick = () =>
    safe(async () => {
      await activate();
      engine.hit(i + 35);
      status(`${i + 35} · ${name}`);
    });
  $("gm").append(b);
});
function frame() {
  const time = engine.now();
  $<HTMLInputElement>("seek").value = String(time);
  $("time").textContent = format(time);
  $("play").textContent = engine.playing ? "Ⅱ" : "▶";
  $("play").setAttribute("aria-label", engine.playing ? "Pause" : "Play");
  midiMap.frame(time, engine.playing, engine.rate, engine.loop);
  requestAnimationFrame(frame);
}
songUI();
pads();
frame();
safe(refreshKits);
