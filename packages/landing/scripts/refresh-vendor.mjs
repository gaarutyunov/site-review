#!/usr/bin/env node
// Download the standalone @gaarutyunov/ui-kit bundle from a GitHub release and
// vendor it into ./vendor. Keeps the landing page buildless + self-contained.
//
//   node scripts/refresh-vendor.mjs            # latest release
//   node scripts/refresh-vendor.mjs v0.2.0     # a specific tag
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = "gaarutyunov/ui-kit";
const ASSETS = ["ga-ui-kit.css", "ga-ui-kit.min.js"];
const here = dirname(fileURLToPath(import.meta.url));
const vendorDir = join(here, "..", "vendor");

const tag = process.argv[2];
const base = tag
  ? `https://github.com/${REPO}/releases/download/${tag}`
  : `https://github.com/${REPO}/releases/latest/download`;

for (const name of ASSETS) {
  const url = `${base}/${name}`;
  process.stdout.write(`↓ ${url}\n`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(join(vendorDir, name), buf);
}
process.stdout.write(`✓ vendored ui-kit ${tag ?? "(latest)"} → ${vendorDir}\n`);
