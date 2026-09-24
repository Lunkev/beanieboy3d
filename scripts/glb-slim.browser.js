// Klistras in i den inbyggda browsern (javascript_tool) — krymper en GLB genom att koda om inbäddade
// PNG/JPEG-texturer till JPEG (max `maxSize` px). Meshy-karaktärer går typiskt från 7–8 MB till ~1 MB.
// Användning:  const b64 = await __slimGLB(url, 1024, 0.86);  → base64-sträng av den nya GLB:n
// (returnera max ~1 MB base64 per javascript_tool-anrop — bryggan kapar större svar)
window.__slimGLB = async (url, maxSize = 1024, quality = 0.86) => {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;
  const bin = new Uint8Array(buf, binStart, dv.getUint32(20 + jsonLen, true));
  const views = json.bufferViews.map((v) => bin.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
  for (const img of json.images || []) {
    if (img.bufferView == null) continue;
    const bmp = await createImageBitmap(new Blob([views[img.bufferView]], { type: img.mimeType }));
    const s = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const jpg = new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg", quality })).arrayBuffer());
    views[img.bufferView] = jpg; img.mimeType = "image/jpeg";
  }
  // bygg ny BIN med 4-bytes-alignment
  let off = 0; const parts = [];
  json.bufferViews.forEach((v, i) => { const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(new Uint8Array(pad)); off += pad; } v.byteOffset = off; v.byteLength = views[i].length; parts.push(views[i]); off += views[i].length; });
  const binPad = (4 - (off % 4)) % 4; if (binPad) { parts.push(new Uint8Array(binPad)); off += binPad; }
  json.buffers = [{ byteLength: off }];
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jp = (4 - (jsonBytes.length % 4)) % 4;
  if (jp) { const t = new Uint8Array(jsonBytes.length + jp).fill(0x20); t.set(jsonBytes); jsonBytes = t; }
  const total = 12 + 8 + jsonBytes.length + 8 + off;
  const out = new Uint8Array(total); const o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, total, true);
  o.setUint32(12, jsonBytes.length, true); o.setUint32(16, 0x4e4f534a, true); out.set(jsonBytes, 20);
  let p = 20 + jsonBytes.length; o.setUint32(p, off, true); o.setUint32(p + 4, 0x004e4942, true); p += 8;
  for (const part of parts) { out.set(part, p); p += part.length; }
  let s = ""; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
  return btoa(s);
};
window.__b64 = async (u) => { const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
"ok";
