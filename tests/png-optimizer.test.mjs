import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { deflateSync, inflateSync } from 'node:zlib';
import { createPngOptimizer } from '../public/png-optimizer.mjs';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, payload) {
  const bytes = Buffer.alloc(payload.length + 12); bytes.writeUInt32BE(payload.length);
  bytes.write(type, 4); payload.copy(bytes, 8); bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4); return bytes;
}
function rgbaPng(width, height, rgba, compression = 0) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: compression })), chunk('IEND', Buffer.alloc(0))]);
}
// Independent decoder for this fixture's RGBA8 PNGs. Verify every reconstructed
// channel, including invisible RGB beneath alpha=0, rather than just dimensions.
function decodeRgba(bytes) {
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
      const prediction = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      rgba[target] = (scan[y * (stride + 1) + 1 + x] + prediction) & 255;
    }
  }
  return { width, height, rgba };
}

class NodeWorker {
  constructor() { this.worker = new Worker(new URL('./png-worker-node.mjs', import.meta.url)); this.callbacks = new Map(); }
  addEventListener(type, fn) { const callback = value => fn(type === 'message' ? { data: value } : value); if (!this.callbacks.has(type)) this.callbacks.set(type, new Map()); this.callbacks.get(type).set(fn, callback); this.worker.on(type, callback); }
  removeEventListener(type, fn) { this.worker.off(type, this.callbacks.get(type).get(fn)); this.callbacks.get(type).delete(fn); }
  postMessage(data, transfer) { this.worker.postMessage(data, transfer); }
  terminate() { this.worker.terminate(); }
}
class FakeWorker {
  constructor(action) { this.action = action; this.listeners = new Map(); this.terminated = false; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type) { this.listeners.delete(type); }
  postMessage(data) { queueMicrotask(() => this.action(data, this)); }
  emit(type, data) { this.listeners.get(type)?.(type === 'message' ? { data } : data); }
  terminate() { this.terminated = true; }
}
const pixels = Buffer.alloc(8 * 8 * 4, 100);
const baseline = new Blob([rgbaPng(8, 8, pixels)], { type: 'image/png' });
const smaller = rgbaPng(8, 8, pixels, 9);
const reply = bytes => (data, worker) => worker.emit('message', { id: data.id, bytes: Uint8Array.from(bytes).buffer });

test('real worker/WASM preserves RGBA and transparent RGB, reuses a worker, and keeps baseline bytes', async t => {
  const width = 80, height = 48, rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = i & 255; rgba[i * 4 + 1] = (i * 7 + 31) & 255;
    rgba[i * 4 + 2] = (Math.floor(i / 3) + 19) & 255; rgba[i * 4 + 3] = i % 11 ? (i * 13) & 255 : 0;
  }
  const input = rgbaPng(width, height, rgba), blob = new Blob([input], { type: 'image/png' });
  let workers = 0;
  const optimizer = createPngOptimizer({ workerFactory: () => { workers++; return new NodeWorker(); } });
  t.after(optimizer.dispose);
  for (let index = 0; index < 2; index++) {
    const result = await optimizer.optimize(blob);
    assert.equal(result.status, 'optimized'); assert(result.blob.size < blob.size);
    const decoded = decodeRgba(Buffer.from(await result.blob.arrayBuffer()));
    assert.equal(decoded.width, width); assert.equal(decoded.height, height); assert.deepEqual(decoded.rgba, rgba);
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), input);
  }
  assert.equal(workers, 1);
});

test('only smaller matching PNGs are accepted; equal/larger/invalid/dimension-changed outputs fall back', async () => {
  const equal = Buffer.from(await baseline.arrayBuffer()), larger = Buffer.concat([equal.subarray(0, -12), chunk('tEXt', Buffer.from('note\0larger candidate')), equal.subarray(-12)]);
  for (const candidate of [equal, larger, Buffer.alloc(20), rgbaPng(4, 4, pixels.subarray(0, 64), 9)]) {
    const optimizer = createPngOptimizer({ workerFactory: () => new FakeWorker(reply(candidate)) });
    const result = await optimizer.optimize(baseline); optimizer.dispose();
    assert.strictEqual(result.blob, baseline); assert.equal(result.savedBytes, 0);
  }
  const optimizer = createPngOptimizer({ workerFactory: () => new FakeWorker(reply(smaller)) });
  const result = await optimizer.optimize(baseline); optimizer.dispose();
  assert.equal(result.status, 'optimized'); assert.equal(result.savedBytes, baseline.size - smaller.length);
});

test('worker failures keep the PNG and next image recreates the worker', async () => {
  let count = 0, failedWorker;
  const optimizer = createPngOptimizer({ workerFactory: () => ++count === 1 ? (failedWorker = new FakeWorker((data, worker) => worker.emit('message', { id: data.id, error: 'codec failure' }))) : new FakeWorker(reply(smaller)) });
  const first = await optimizer.optimize(baseline);
  assert.equal(first.status, 'failed'); assert.strictEqual(first.blob, baseline); assert(failedWorker.terminated);
  assert.equal((await optimizer.optimize(baseline)).status, 'optimized'); assert.equal(count, 2); optimizer.dispose();
  const unavailable = createPngOptimizer({ workerFactory: () => { throw Error('Worker unavailable'); } });
  assert.strictEqual((await unavailable.optimize(baseline)).blob, baseline);
});

test('timeout and cancellation terminate expensive work, preserve PNG, and allow recovery', async () => {
  let active;
  const optimizer = createPngOptimizer({ timeoutMs: 20, workerFactory: () => (active = new FakeWorker(() => {})) });
  const timeout = await optimizer.optimize(baseline);
  assert.equal(timeout.status, 'timed-out'); assert.strictEqual(timeout.blob, baseline); assert(active.terminated);
  const controller = new AbortController(), waiting = optimizer.optimize(baseline, { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  const cancelled = await waiting;
  assert.equal(cancelled.status, 'aborted'); assert.strictEqual(cancelled.blob, baseline); assert(active.terminated);
  const alreadyCancelled = await optimizer.optimize(baseline, { signal: controller.signal });
  assert.equal(alreadyCancelled.status, 'aborted'); optimizer.dispose();
});
