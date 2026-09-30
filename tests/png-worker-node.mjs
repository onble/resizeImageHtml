// Native test adapter: run the production worker/codec without a browser.
import { parentPort } from 'node:worker_threads';
import fs from 'node:fs/promises';

globalThis.self = {
  addEventListener: (_type, listener) => parentPort.on('message', data => listener({ data })),
  postMessage: (data, transfer) => parentPort.postMessage(data, transfer)
};
globalThis.fetch = async url => new Response(await fs.readFile(url));
await import('../public/png-worker.mjs');
