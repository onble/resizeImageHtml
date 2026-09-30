// A session owns one worker. Reuse it across a batch; discard it on failure,
// timeout or cancellation so the next image can safely create a fresh worker.
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
function dimensions(bytes) {
  if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) return null;
  return `${view.getUint32(16)}x${view.getUint32(20)}`;
}

export function createPngOptimizer({ workerFactory = () => new Worker(new URL('./png-worker.mjs', import.meta.url), { type: 'module' }), timeoutMs = 30000 } = {}) {
  let worker, requestId = 0;
  const dispose = () => { worker?.terminate(); worker = undefined; };

  function run(bytes, signal) {
    return new Promise(resolve => {
      if (signal?.aborted) { resolve({ status: 'aborted' }); return; }
      try { worker ??= workerFactory(); } catch { resolve({ status: 'failed' }); return; }
      const activeWorker = worker, id = ++requestId;
      let settled = false;
      const finish = (result, reset = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        activeWorker.removeEventListener('message', message);
        activeWorker.removeEventListener('error', failure);
        activeWorker.removeEventListener('messageerror', failure);
        if (reset) dispose();
        resolve(result);
      };
      const abort = () => finish({ status: 'aborted' }, true);
      const failure = () => finish({ status: 'failed' }, true);
      const message = event => {
        if (event.data?.id !== id) return;
        if (event.data.error) failure();
        else finish({ status: 'complete', bytes: event.data.bytes });
      };
      const timer = setTimeout(() => finish({ status: 'timed-out' }, true), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      activeWorker.addEventListener('message', message);
      activeWorker.addEventListener('error', failure);
      activeWorker.addEventListener('messageerror', failure);
      try { activeWorker.postMessage({ id, bytes: bytes.buffer }, [bytes.buffer]); } catch { failure(); }
    });
  }

  async function optimize(blob, { signal } = {}) {
    const fallback = status => ({ blob, status, originalBytes: blob.size, optimizedBytes: blob.size, savedBytes: 0 });
    if (signal?.aborted) return fallback('aborted');
    try {
      // Transferring this private buffer does not detach the original Blob.
      const original = new Uint8Array(await blob.arrayBuffer());
      const originalDimensions = dimensions(original);
      if (!originalDimensions) return fallback('failed');
      const result = await run(original, signal);
      if (result.status !== 'complete') return fallback(result.status);
      const candidate = new Uint8Array(result.bytes);
      if (dimensions(candidate) !== originalDimensions) { dispose(); return fallback('failed'); }
      if (candidate.byteLength >= blob.size) return fallback('unchanged');
      return { blob: new Blob([candidate], { type: 'image/png' }), status: 'optimized', originalBytes: blob.size, optimizedBytes: candidate.byteLength, savedBytes: blob.size - candidate.byteLength };
    } catch { dispose(); return fallback('failed'); }
  }
  return { optimize, dispose };
}
