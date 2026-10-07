import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = path.join(root, "media", "assets", "chart");
const files = [
  "answer.wav", "tap.wav", "touch.wav", "break.wav", "slide.wav", "cheer.wav", "ex.wav",
  "firework.wav", "break_slide.wav", "break_slide_cheer.wav", "touch_hold.wav", "sensor.webp",
];

if (process.argv[2] === "--check") {
  const missing = [];
  for (const file of files) {
    try { await access(path.join(target, file)); }
    catch { missing.push(file); }
  }
  if (missing.length) {
    console.error(`Missing local chart assets: ${missing.join(", ")}.`);
    console.error("Run yarn assets:import /absolute/path/to/chart-assets with assets you may use before packaging.");
    process.exitCode = 1;
  }
} else if (process.argv[2]) {
  const source = path.resolve(process.argv[2]);
  for (const file of files) await access(path.join(source, file));
  await mkdir(target, { recursive: true });
  for (const file of files) await copyFile(path.join(source, file), path.join(target, file));
  console.log(`Imported ${files.length} chart assets into media/assets/chart/.`);
} else {
  console.error("Usage: yarn assets:import /absolute/path/to/chart-assets");
  process.exitCode = 1;
}
