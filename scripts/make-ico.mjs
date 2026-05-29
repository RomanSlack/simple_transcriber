// Build a multi-size Windows .ico from the PNG icons, with PNG payloads
// (supported by Windows Vista+). No external dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sizes = [16, 32, 48, 64, 128, 256];

const images = sizes.map((size) => ({
  size,
  data: readFileSync(path.join(root, 'assets', `icon-${size}.png`)),
}));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4); // count

const entrySize = 16;
let offset = header.length + images.length * entrySize;
const entries = [];
for (const img of images) {
  const e = Buffer.alloc(entrySize);
  e.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // width (0 == 256)
  e.writeUInt8(img.size >= 256 ? 0 : img.size, 1); // height
  e.writeUInt8(0, 2); // palette
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // color planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(img.data.length, 8); // size of image data
  e.writeUInt32LE(offset, 12); // offset of image data
  offset += img.data.length;
  entries.push(e);
}

const out = Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
const dest = path.join(root, 'assets', 'icon.ico');
writeFileSync(dest, out);
console.log(`Wrote ${dest} (${images.length} sizes, ${out.length} bytes)`);
