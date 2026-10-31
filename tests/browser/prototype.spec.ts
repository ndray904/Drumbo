import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
function wav() {
  const b = Buffer.alloc(44 + 1600);
  b.write("RIFF", 0);
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(1600, 40);
  for (let i = 0; i < 800; i++)
    b.writeInt16LE(Math.round(Math.sin(i * 0.1) * 12000), 44 + i * 2);
  return b;
}
test("transport, MIDI channel selection, touch activation, and layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".pad")).toHaveCount(16);
  await expect(page.locator("#gm button")).toHaveCount(47);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("#activate")).toHaveText("● Audio active");
  await expect.poll(() => page.locator("#seek").inputValue()).not.toBe("0");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.locator("#tempo").fill("90");
  await page.locator("#tempo").dispatchEvent("change");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("#seek")).toHaveValue("0");
  const track = [
    0, 146, 42, 100, 120, 130, 42, 0, 0, 153, 36, 100, 120, 137, 36, 0, 0, 255,
    47, 0,
  ];
  const midi = Buffer.from([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    0,
    0,
    1,
    1,
    224,
    77,
    84,
    114,
    107,
    0,
    0,
    0,
    track.length,
    ...track,
  ]);
  await page.locator("#midi").setInputFiles({
    name: "channels.mid",
    mimeType: "audio/midi",
    buffer: midi,
  });
  await expect(page.locator("#channel")).toHaveValue("9");
  await page.locator("#channel").selectOption("2");
  await expect(page.locator("#channel")).toHaveValue("2");
  await page.locator(".strike").first().click();
  await expect(page.locator("#activate")).toHaveText("● Audio active");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("custom audio survives portable export/import and IndexedDB reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".pad input[type=file]").first().setInputFiles({
    name: "test-kick.wav",
    mimeType: "audio/wav",
    buffer: wav(),
  });
  await expect(page.locator(".strike small").first()).toHaveText(
    "test-kick.wav",
  );
  await page.locator("#kitname").fill("Portable test kit");
  await page.locator("#kitname").blur();
  const downloaded = page.waitForEvent("download");
  if (test.info().project.name === "mobile")
    await page.locator("#export").tap();
  else await page.locator("#export").click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = Buffer.concat(chunks);
  const parsed = JSON.parse(exported.toString());
  expect(parsed.slots[0].audio).toContain("data:audio/");
  await page.locator("#save").click();
  await expect(page.locator("#status")).toContainText("Saved");
  await page.reload();
  await page.locator("#saved").selectOption("Portable test kit");
  await expect(page.locator(".strike small").first()).toHaveText(
    "test-kick.wav",
  );
  await page.locator(".reset").first().click();
  await expect(page.locator(".strike small").first()).toHaveText(
    "Generated starter",
  );
  await page.locator("#import").setInputFiles({
    name: "kit.json",
    mimeType: "application/json",
    buffer: exported,
  });
  await expect(page.locator(".strike small").first()).toHaveText(
    "test-kick.wav",
  );
});
test("standalone preview runs with no network requests", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  await page.goto(pathToFileURL(resolve("dist/drumbo-preview.html")).href);
  await expect(page.locator(".pad")).toHaveCount(16);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("#activate")).toHaveText("● Audio active");
  await expect.poll(() => page.locator("#seek").inputValue()).not.toBe("0");
  expect(requests).toEqual([]);
});
