import { test, expect } from "@playwright/test";

function variableLength(value: number) {
  const bytes = [value & 0x7f];
  while ((value >>= 7)) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}

function midiTrack(channel: number, notes: [number, number][]) {
  const events = notes.flatMap(([tick, note]) => [
    { tick, data: [0x90 | channel, note, 100] },
    { tick: tick + 120, data: [0x80 | channel, note, 0] },
  ]);
  events.sort((a, b) => a.tick - b.tick);
  const bytes: number[] = [];
  let previous = 0;
  for (const event of events) {
    bytes.push(...variableLength(event.tick - previous), ...event.data);
    previous = event.tick;
  }
  bytes.push(...variableLength(3840 - previous), 0xff, 0x2f, 0);
  const header = Buffer.alloc(8);
  header.write("MTrk");
  header.writeUInt32BE(bytes.length, 4);
  return Buffer.concat([header, Buffer.from(bytes)]);
}

function mappingMidi(empty = false) {
  const tracks = empty
    ? [midiTrack(9, [])]
    : [
        midiTrack(9, [
          [0, 35],
          [240, 36],
          [480, 82],
          [720, 35],
        ]),
        midiTrack(2, [
          [0, 42],
          [960, 42],
        ]),
      ];
  const header = Buffer.alloc(14);
  header.write("MThd");
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(tracks.length === 1 ? 0 : 1, 8);
  header.writeUInt16BE(tracks.length, 10);
  header.writeUInt16BE(480, 12);
  return Buffer.concat([header, ...tracks]);
}

function wav() {
  const buffer = Buffer.alloc(44 + 1600);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(1600, 40);
  for (let i = 0; i < 800; i++)
    buffer.writeInt16LE(Math.round(Math.sin(i * 0.1) * 12000), 44 + i * 2);
  return buffer;
}

test("compact file note map keeps sixteen named kit lanes and filters MIDI hits by channel", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator("#midi").setInputFiles({
    name: "note-map.mid",
    mimeType: "audio/midi",
    buffer: mappingMidi(),
  });
  await expect(page.locator("#channel")).toHaveValue("9");
  await expect(page.locator("#midi-map")).toHaveAttribute("title", "note-map.mid");
  const rows = page.locator(".midi-map-row");
  await expect(rows).toHaveCount(16);
  expect(
    await rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-note")),
    ),
  ).toEqual(
    [36, 38, 42, 46, 49, 51, 37, 39, 41, 43, 45, 47, 48, 50, 54, 56].map(
      String,
    ),
  );
  await expect(page.locator('.midi-map-row[data-note="35"]')).toHaveCount(0);
  await expect(page.locator('.midi-map-row[data-note="82"]')).toHaveCount(0);
  const kick = page.locator('.midi-map-row[data-note="36"]');
  const hiHat = page.locator('.midi-map-row[data-note="42"]');
  await expect(kick).toHaveText("Bass Drum 1");
  await expect(kick.locator(".midi-map-note")).toHaveText("Bass Drum 1");
  await expect(hiHat).toHaveText("Closed Hi-Hat");
  await expect(kick.locator(".midi-map-hit")).toHaveCount(1);
  await expect(hiHat.locator(".midi-map-hit")).toHaveCount(0);

  const heights = await rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().height),
  );
  expect(new Set(heights).size).toBe(1);
  expect(heights[0]).toBeGreaterThan(0);
  expect(heights[0]).toBeLessThanOrEqual(28);
  expect(
    await page
      .locator(".midi-map-grid")
      .evaluate((grid) => grid.scrollHeight === grid.clientHeight),
  ).toBe(true);

  await page.locator("#channel").selectOption("-1");
  await expect(rows).toHaveCount(16);
  await expect(hiHat.locator(".midi-map-hit")).toHaveCount(2);
  await expect(kick.locator(".midi-map-hit")).toHaveCount(1);
  await page.locator("#channel").selectOption("2");
  await expect(rows).toHaveCount(16);
  await expect(hiHat.locator(".midi-map-hit")).toHaveCount(2);
  await expect(kick.locator(".midi-map-hit")).toHaveCount(0);

  await page.locator("#midi").setInputFiles({
    name: "empty.mid",
    mimeType: "audio/midi",
    buffer: mappingMidi(true),
  });
  await expect(rows).toHaveCount(16);
  await expect(page.locator(".midi-map-hit")).toHaveCount(0);
  await expect(kick).toHaveText("Bass Drum 1");
  expect(errors).toEqual([]);
});

test("file note map updates immediately when pads are remapped, silenced, or given samples", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#midi").setInputFiles({
    name: "mapping.mid",
    mimeType: "audio/midi",
    buffer: mappingMidi(),
  });
  const row = page.locator('.midi-map-row[data-note="35"]');
  await page.locator(".pad select").first().selectOption("35");
  await expect(page.locator(".midi-map-row")).toHaveCount(16);
  await expect(row).toHaveText("Acoustic Bass Drum");
  await expect(row).toHaveAttribute("title", /pad 01/i);
  await expect(row).toHaveAttribute("data-audible", "true");
  await expect(row.locator(".midi-map-hit")).toHaveCount(2);
  await expect(page.locator('.midi-map-row[data-note="36"]')).toHaveCount(0);

  await page.locator(".pad .mute").first().click();
  await expect(row).toHaveAttribute("title", /muted/i);
  await expect(row).toHaveAttribute("data-audible", "false");
  await page.locator(".pad .mute").first().click();
  await page.locator(".pad .solo").nth(1).click();
  await expect(row).toHaveAttribute("title", /solo/i);
  await expect(row).toHaveAttribute("data-audible", "false");
  await page.locator(".pad .solo").nth(1).click();
  await page
    .locator(".pad-controls input[type=range]")
    .first()
    .evaluate((input: HTMLInputElement) => {
      input.value = "0";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await expect(row).toHaveAttribute("title", /volume.*0|zero volume/i);
  await expect(row).toHaveAttribute("data-audible", "false");

  await page.locator(".pad input[type=file]").first().setInputFiles({
    name: "mapped-kick.wav",
    mimeType: "audio/wav",
    buffer: wav(),
  });
  await expect(row).toHaveAttribute("title", /mapped-kick\.wav/);
  await expect(row.locator(".midi-map-note")).toHaveText("Acoustic Bass Drum");
  await page.locator(".pad .reset").first().click();
  await expect(row).toHaveAttribute("title", /generated starter/i);
  await expect(row).toHaveText("Acoustic Bass Drum");
});

test("MIDI map audition, playhead, and note activity follow playback and seek controls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".midi-map-row")).toHaveCount(16);
  await page
    .getByRole("button", { name: "Audition MIDI note 36", exact: true })
    .click();
  await expect(page.locator("#activate")).toContainText("Audio active");
  await page
    .getByRole("button", { name: "Play MIDI map", exact: true })
    .click();
  await expect.poll(() => page.locator("#map-seek").inputValue()).not.toBe("0");
  await expect
    .poll(() => page.locator(".midi-map-row.is-active").count())
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page
        .locator(".midi-map-playhead")
        .evaluate((element: HTMLElement) => parseFloat(element.style.left)),
    )
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Pause MIDI map", exact: true })
    .click();
  await expect(page.locator(".midi-map-row.is-active")).toHaveCount(0);

  await page.locator("#map-seek").evaluate((input: HTMLInputElement) => {
    input.value = "3.25";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#seek")).toHaveValue("3.25");
  await expect(page.locator("#map-seek")).toHaveValue("3.25");
  await expect
    .poll(() =>
      page
        .locator(".midi-map-playhead")
        .evaluate((element: HTMLElement) => parseFloat(element.style.left)),
    )
    .toBeCloseTo(40.625, 1);
  await page
    .getByRole("button", { name: "Stop MIDI map", exact: true })
    .click();
  await expect(page.locator("#seek")).toHaveValue("0");
  await expect(page.locator("#map-seek")).toHaveValue("0");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
