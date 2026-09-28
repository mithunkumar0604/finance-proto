// Post-build step for static hosting.
// Next 16's static export writes segment-prefetch payloads as nested folders
// (out/home/__next.X/home/__PAGE__.txt) but the client router requests them as
// flat dotted file names (out/home/__next.X.home.__PAGE__.txt). Hosts without
// Next-aware routing (e.g. GitHub Pages) then 404 on every prefetch. This copies
// each nested payload to the flat name the router asks for.
import { copyFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const OUT = "out";
let copied = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.startsWith("__next.")) flatten(dir, full);
    else walk(full);
  }
}

function flatten(routeDir, segDir) {
  for (const name of readdirSync(segDir)) {
    const full = join(segDir, name);
    if (statSync(full).isDirectory()) flatten(routeDir, full);
    else {
      const flat = relative(routeDir, full).split(sep).join(".");
      copyFileSync(full, join(routeDir, flat));
      copied++;
    }
  }
}

walk(OUT);
console.log(`flatten-rsc: wrote ${copied} prefetch files`);
