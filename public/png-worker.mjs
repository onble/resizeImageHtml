import initOxiPng, { optimise } from './vendor/oxipng/squoosh_oxipng.js';

let ready;
async function initialize() {
  ready ??= (async () => {
    const response = await fetch(new URL('./vendor/oxipng/squoosh_oxipng_bg.wasm', import.meta.url));
    if (!response.ok) throw new Error('PNG optimizer could not load');
    await initOxiPng(await response.arrayBuffer());
  })();
  await ready;
}

self.addEventListener('message', async ({ data }) => {
  try {
    await initialize();
    // Level 2, no interlacing, and no rewriting RGB under transparent pixels.
    const result = optimise(new Uint8Array(data.bytes), 2, false, false);
    const bytes = Uint8Array.from(result).buffer;
    self.postMessage({ id: data.id, bytes }, [bytes]);
  } catch (error) { self.postMessage({ id: data.id, error: error.message || 'PNG optimization failed' }); }
});
