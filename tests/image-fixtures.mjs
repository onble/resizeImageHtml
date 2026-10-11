import { deflateSync, inflateSync } from 'node:zlib';
import assert from 'node:assert/strict';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, payload) {
  const bytes = Buffer.alloc(payload.length + 12); bytes.writeUInt32BE(payload.length);
  bytes.write(type, 4); payload.copy(bytes, 8); bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4); return bytes;
}
export function rgbaPng(width, height, rgba) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
export const fixturePixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 12, 34, 56, 0, 1, 2, 3, 254, 40, 50, 60, 255, 100, 120, 140, 255]);
export const fixture = rgbaPng(2, 3, fixturePixels);
export const fixtureOptions = { mode: 'height', height: 3, format: 'png', pngOptimize: true };

export function decodeRgba(bytes) {
  const idat = []; let header;
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8), payload = bytes.subarray(offset + 8, offset + 8 + size);
    assert.equal(crc32(bytes.subarray(offset + 4, offset + 8 + size)), bytes.readUInt32BE(offset + 8 + size));
    if (type === 'IHDR') header = payload; if (type === 'IDAT') idat.push(payload);
    offset += size + 12;
  }
  assert.deepEqual([...header.subarray(8)], [8, 6, 0, 0, 0]);
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4), stride = width * 4;
  const scan = inflateSync(Buffer.concat(idat)), rgba = Buffer.alloc(width * height * 4);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = scan[y * (stride + 1)]; assert(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const target = y * stride + x, a = x >= 4 ? rgba[target - 4] : 0, b = y ? rgba[target - stride] : 0, c = y && x >= 4 ? rgba[target - stride - 4] : 0;
      rgba[target] = (scan[y * (stride + 1) + 1 + x] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) & 255;
    }
  }
  return { width, height, rgba };
}
