#!/usr/bin/env node
// Assemble the buildless landing page into ./dist by copying the static files.
// No bundler: the page is plain HTML + CSS + the vendored ga-ui-kit bundle,
// all referenced with relative paths so it works at any deploy base (root or a
// PR-preview subpath).
import { cp, rm, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const ENTRIES = ["index.html", "landing.css", "vendor", "public"];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const name of ENTRIES) {
  await cp(join(root, name), join(dist, name), { recursive: true });
}

process.stdout.write(`✓ landing assembled → ${dist}\n`);
