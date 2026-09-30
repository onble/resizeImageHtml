# Resize Studio

A local image workbench for fast, repeatable batch resizing. Drop your assets, choose a resize mode, preview the result, and export directly to your folder.

[简体中文](README.zh-CN.md)

## Quick start

On Windows, double-click **start.cmd**. The service runs in the background and opens `http://127.0.0.1:4178` in your default browser. Starting it again opens the existing session. Double-click **停止工具.cmd** to stop the service.

Requires **Node.js 20 or later**. No npm installation, build step, or Python environment is required. The PNG optimizer is bundled locally with its license notices; you do not need to run `npm install`.

```sh
npm start
```

This runs the server in the foreground; closing the terminal stops it. Open the local URL instead of opening `public/index.html` directly: folder access requires the local service.

## Highlights

- **Batch input:** drop multiple images or entire folders, or use the file and folder pickers.
- **Five resize modes:** proportional height, proportional width, exact dimensions, percentage, and bounded fit.
- **Before-and-after previews:** compare output dimensions, transparency, and encoded quality.
- **Folder watching:** discover new images every three seconds, select them automatically, and show them first.
- **Direct export:** write to your chosen destination with optional subfolders, filename suffixes, and collision handling.
- **Lossless PNG optimization:** enabled by default, with per-file and batch savings shown in Activity; keep the original encoding when optimization is not useful or unavailable.
- **English / 中文:** switch from the header. English is the default; your choice is remembered in this browser.
- **Light / dark mode:** a blue accent with neutral work surfaces; the theme is remembered independently of language.
- **Local processing:** Canvas handles the images in your browser; Node.js handles local filesystem access. No cloud uploads.

## Everyday workflow

1. Drop images or a folder, or load an asset folder. The default is `./input`. Use **Browse** or enter a relative or absolute path and click **Load** to change it.
2. Select the assets to process. Dropped images are selected automatically. Existing folder images are initially unselected; new arrivals detected while the page is running are selected automatically. Click a thumbnail to preview it.
3. Choose a mode and set its dimensions or percentage. Search filters the list; **Select visible** selects the filtered assets, while **Deselect all** clears all selections.
4. Choose a destination and click **Resize & export**. Use **Open output folder** to view the results. Stopping a batch leaves completed files in place.

Switching language preserves your selections, filenames, folder paths, and resize settings. Buttons, descriptions, status messages, previews, and activity entries follow the selected language.

## Resize modes

| Mode | Result |
| --- | --- |
| By height | Fixed height, proportional width. Example: 120 × 600 at height 300 becomes 60 × 300. |
| By width | Fixed width, proportional height. |
| Exact dimensions · Stretch | Force the requested width and height; proportions may change. |
| Exact dimensions · Pad | Fit the complete image into a centered, fixed-size canvas; PNG/WebP padding is transparent. |
| Exact dimensions · Crop | Fill the canvas proportionally and crop the excess from the center. |
| By percentage | 50% halves both dimensions; 80% scales them to 0.8×. |
| Fit within bounds | Fit proportionally within maximum dimensions and export the actual size without padding. |

Upscaling is disabled by default; enable **Allow upscaling** when needed. Use **Pixel art / nearest neighbor** for crisp pixel assets. Other images use the browser's high-quality smoothing. This differs from Pillow LANCZOS; compare the preview when visual fidelity matters. Proportional dimension rounding matches Python's rounding at `.5` for compatibility with the original tool.

## Lossless PNG optimization

When PNG is selected, **Optimize PNG losslessly** is checked by default. You can turn it off; the choice is remembered with your resize settings. The option is hidden for JPG/WebP and does not affect those formats.

After resizing and PNG encoding, the bundled OxiPNG codec optimizes the bytes in a Web Worker. It uses level 2, does not quantize colors, and does not rewrite RGB beneath transparent pixels. Only a strictly smaller PNG with matching dimensions is accepted. An unavailable worker, codec failure, or 30-second timeout falls back to the baseline PNG so export can continue.

Preview uses the same optimization path and shows the final encoded file size. Activity reports each file's before/after sizes and savings, plus total savings for files actually written in the batch. Skipped and failed exports do not count toward saved bytes.

A batch reuses its worker. Stop cancels an active optimization and avoids writing a not-yet-exported image; files already saved remain in place. Closing a preview cancels its optimization. Optimization reduces file bytes; resizing itself still changes pixel information.

Bundled files and licenses: [OxiPNG notice](public/vendor/oxipng/NOTICE.md).

## Folder watching and ordering

**Watch folder for changes** scans recursively every three seconds while the page is open. It adds or updates images, removes deleted files, and preserves existing selections. Watching pauses during export and does **not** automatically process or export images. Background tabs may be throttled; use **Refresh now** when needed. Closing the page stops scanning.

New arrivals and imports appear first, ordered by detection/import time descending. Files in the same batch are ordered by name, with numeric sorting. Existing files are ordered by modification time descending, then name. Old files copied into the folder still count as new arrivals. Deselecting an asset persists across refreshes; replacing a file preserves its selection and arrival time. Changing the input folder starts a fresh scan with existing files unselected.

Dropping a folder imports a snapshot. To keep it synchronized, load it as the asset folder. Non-image files, including `.meta` files, are ignored.

## Inputs, exports, and originals

- Default input: `./input`. Default output: `./output`. Relative paths resolve against this project's folder, regardless of the launch directory, so the project can be moved as a whole.
- Your explicit destination takes priority. An empty destination restores `./output`; missing folders are created automatically. Existing output folders are never cleared.
- The original Python tool at `D:\project\cmzn\tools\resizeImage` and its input/output remain separate and preserved.
- Input/output paths and watching preferences are stored in `settings.json`. Resize settings, theme, and language are stored in browser localStorage.
- Subfolder structure is preserved by default. Dropped/imported folders include their top-level folder name; watched assets use the selected folder as their root. Disable the option for flat output.
- Existing files receive `_1`, `_2`, etc. by default. You may choose **Skip** or explicitly choose **Overwrite destination**.
- Keep the destination outside the source folder. The server rejects writes into the loaded input folder. Browsers do not expose absolute source paths for dropped files, so choose a separate destination for those files, especially when overwriting.
- Import PNG, JPG, WebP, and BMP. Export PNG, WebP, or JPG with matching extensions. PNG/WebP preserve transparency; JPG uses a white background. WebP/JPG offer encoding-quality controls.

The service listens only on `127.0.0.1`, checks Host/Origin and request tokens, and validates paths and symbolic links. Batches process one image at a time. Limits: 80 MB per exported file, 16384 px per side, and approximately 32 million output pixels.

“Size” refers to pixel dimensions, not a target KB/MB file size. Animated GIF, TIFF, Excel size mappings, and indexed 256-color PNG output are not currently supported.

## Development and AI-assisted changes

The project uses native HTML, CSS, ES modules, and Node.js built-in modules.

| File | Responsibility |
| --- | --- |
| `public/index.html` | Workspace, controls, and preview dialog; English fallback text. |
| `public/styles.css` | Shared layout and light/dark theme tokens. |
| `public/i18n.js` | English/Chinese catalog, language persistence, static labels, and error presentation. |
| `public/theme.js` | Theme restoration before the stylesheet and the header toggle. |
| `public/app.js` | Imports, selections, watching, previews, exports, and translated activity. |
| `public/library.mjs` | Asset reconciliation and ordering. |
| `public/resize.mjs` | Geometry, Canvas rendering, encoding, and output naming. |
| `public/png-optimizer.mjs` / `public/png-worker.mjs` | Reusable worker sessions, lossless PNG optimization, timeouts, cancellation, and fallback. |
| `public/vendor/oxipng/` | Local JS/WASM codec and third-party notices. |
| `server.mjs` | Local filesystem APIs and static serving. |
| `tests/core.test.mjs` | Resize, filesystem, and HTTP checks. |
| `tests/localization.test.mjs` | Language persistence, translation coverage, theme labels, and application state checks using a DOM stub. |
| `tests/png-optimizer.test.mjs` | Real WASM round trips, RGBA preservation, fallback, worker reuse, timeout, and cancellation. |

For a future feature, start an AI conversation in this folder with a request such as:

> Read AGENTS.md and AI_GUIDE.md, then add a target-KB compression mode with preview and batch export. Keep existing output files and originals, and provide English and Chinese labels.

See [AI_GUIDE.md](AI_GUIDE.md) for extension steps and [AGENTS.md](AGENTS.md) for maintenance conventions. Add new user-facing text to `public/i18n.js`, then update both README versions when behavior changes.

## Verification and troubleshooting

```sh
npm test
```

Tests cover geometry, path constraints, folder scans, collision policies, source protection, local API access, and language behavior. Filesystem tests use temporary directories.

Startup logs are in `.runtime/server.log` and `.runtime/server.error.log`. If port 4178 is occupied, choose another port:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Port 4179
```

For network folders, ensure your Windows account can access them. Per-file failures appear in **Activity** and do not stop subsequent files in the batch.

Technical references: [Canvas drawImage](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage), [Canvas smoothing quality](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingQuality), [Node.js filesystem](https://nodejs.org/api/fs.html).
