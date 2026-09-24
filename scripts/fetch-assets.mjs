// Hämtar AI-genererade assets (GLB, bilder, ljud) från Higgsfields CDN till public/ — bara filer som saknas.
// Listan ligger i assets.manifest.json: { "public/models/char.glb": "https://..." }
// Värdet kan också vara { "url": "https://...", "strip": true } → behåll bara skelett + animation (klipp-GLB:er från
// riggning, samma rigg som huvudmodellen) så filen blir några hundra kB i stället för hela meshen med texturer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function stripGlb(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 12, js = null, bin = null;
  while (off < buf.length) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) js = JSON.parse(new TextDecoder().decode(chunk)); else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  for (const n of js.nodes ?? []) { delete n.mesh; delete n.skin; }
  for (const k of ["meshes", "skins", "materials", "textures", "images", "samplers"]) delete js[k];
  const used = [...new Set((js.animations ?? []).flatMap((a) => a.samplers.flatMap((s) => [s.input, s.output])))].sort((a, b) => a - b);
  const amap = new Map(used.map((o, i) => [o, i]));
  for (const a of js.animations ?? []) for (const s of a.samplers) { s.input = amap.get(s.input); s.output = amap.get(s.output); }
  js.accessors = used.map((i) => js.accessors[i]);
  const views = [], parts = []; let pos = 0; const vmap = new Map();
  for (const a of js.accessors) {
    if (a.bufferView == null) continue;
    if (!vmap.has(a.bufferView)) {
      const v = js.bufferViews[a.bufferView], data = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
      const pad = (4 - (pos % 4)) % 4; if (pad) { parts.push(new Uint8Array(pad)); pos += pad; }
      vmap.set(a.bufferView, views.length); views.push({ ...v, buffer: 0, byteOffset: pos, byteLength: data.length }); parts.push(data); pos += data.length;
    }
    a.bufferView = vmap.get(a.bufferView);
  }
  const pad = (4 - (pos % 4)) % 4; if (pad) { parts.push(new Uint8Array(pad)); pos += pad; }
  js.bufferViews = views; js.buffers = [{ byteLength: pos }];
  for (const k of ["extensionsUsed", "extensionsRequired"]) if (js[k]) { js[k] = js[k].filter((e) => !/texture|material|draco|meshopt/i.test(e)); if (!js[k].length) delete js[k]; }
  let j = new TextEncoder().encode(JSON.stringify(js)); const jp = (4 - (j.length % 4)) % 4;
  if (jp) { const t = new Uint8Array(j.length + jp).fill(0x20); t.set(j); j = t; }
  const out = new Uint8Array(12 + 8 + j.length + 8 + pos), o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, out.length, true);
  o.setUint32(12, j.length, true); o.setUint32(16, 0x4e4f534a, true); out.set(j, 20);
  let p = 20 + j.length; o.setUint32(p, pos, true); o.setUint32(p + 4, 0x004e4942, true); p += 8;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

const manifest = existsSync("assets.manifest.json") ? JSON.parse(readFileSync("assets.manifest.json", "utf8")) : {};
const entries = Object.entries(manifest);
let ok = 0, skip = 0, fail = 0;
for (const [path, v] of entries) {
  if (existsSync(path)) { skip++; continue; }
  const url = typeof v === "string" ? v : v.url;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status + " " + r.statusText);
    let data = new Uint8Array(await r.arrayBuffer());
    if (typeof v === "object" && v.strip) data = stripGlb(data);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    ok++; console.log("  ✓", path);
  } catch (e) { fail++; console.log("  ✗", path, "-", e.message); }
}
console.log(`assets: ${ok} hämtade, ${skip} fanns redan, ${fail} misslyckades`);
