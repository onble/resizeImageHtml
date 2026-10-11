# Resize Studio

A local image workbench for fast, repeatable batch resizing. Drop your assets, choose a resize mode, preview the result, and export directly to your folder.

[简体中文](README.zh-CN.md)

For a blocky pixelation filter, use the separate [Pixel Studio project](pixelImage/README.md) and its own `pixelImage/start.cmd` (port 4180). It has independent settings and folders; this Resize Studio continues to use LANCZOS.

## Quick start

On Windows, double-click **start.cmd**. The service runs in the background and opens `http://127.0.0.1:4178` in your default browser. Starting it again reuses a service only when its protocol and build match the current files. An older service is restarted only after its recorded PID, exact project command line, and listening port have been verified. An unverified port owner is left running with an explanatory error. Double-click **停止工具.cmd** to stop the service.

Requires **Node.js 20 or later** and **Python 3.10 or later with Pillow**. No npm installation or build step is required. Startup checks the image-processing runtime and processes a built-in small PNG through Python before reporting the service ready. The server repeats this check before listening, including when launched with `npm start`. These checks do not write to your input/output folders or install dependencies.

An explicit `RESIZE_IMAGE_PYTHON` selects the Python executable. Otherwise discovery checks the project's `.venv`, then `py -3`, `python3`, and `python`, with the bundled Codex runtime as a fallback. To check the selected runtime, protocol, and build without starting the service, run `node image-processor.mjs --check`.

```sh
npm start
```

This runs the server in the foreground; closing the terminal stops it. Open the local URL instead of opening `public/index.html` directly: folder access requires the local service.

## Highlights

- **Batch input:** drop multiple images or entire folders, or use the file and folder pickers.
- **Five resize modes:** proportional height, proportional width, exact dimensions, percentage, and bounded fit.
- **Before-and-after previews:** inspect the result at 1:1 by default, or fit it into the preview area; compare dimensions, transparency, and actual sampling settings.
- **Folder watching:** discover new images every three seconds, select them automatically, and show them first.
- **Direct export:** write to your chosen destination with optional subfolders, filename suffixes, and collision handling.
- **Lossless PNG optimization:** enabled by default, with per-file and batch savings shown in Activity; keep the original encoding when optimization is not useful or unavailable.
- **English / 中文:** switch from the header. English is the default; your choice is remembered in this browser.
- **Light / dark mode:** a blue accent with neutral work surfaces; the theme is remembered independently of language.
- **Local processing:** Python/Pillow resizes and encodes images on your computer, using the copied original tool's LANCZOS processing. Node.js handles local APIs and safe filesystem access. No cloud uploads.

## Everyday workflow

1. Drop images or a folder, or load an asset folder. The default is `./input`. Use **Browse** or enter a relative or absolute path and click **Load** to change it.
2. Select the assets to process. Dropped images are selected automatically. Existing folder images are initially unselected; new arrivals detected while the page is running are selected automatically. Click a thumbnail to preview it.
3. Choose a mode and set its dimensions or percentage. Search filters the list; **Select visible** selects the filtered assets, while **Deselect all** clears all selections.
4. Choose a destination and click **Resize & export**. Use **Open output folder** to view the results. Stopping a batch leaves completed files in place.

The asset toolbar uses labeled icon buttons for **Select visible**, **Deselect all**, and **Clear imports**. Clear imports removes imported assets from the list only; original files stay on disk.

Switching language preserves your selections, filenames, folder paths, and resize settings. Buttons, descriptions, status messages, previews, and activity entries follow the selected language.

**Restore defaults** explicitly selects proportional height 120, PNG, LANCZOS, PNG optimization on, and palette conversion off. The removed nearest-neighbor preference is deleted from saved browser settings; all other saved preferences are preserved. Preview and Activity show the sampling method actually returned by the backend, so comparisons can use the same source, dimensions, and settings.

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

Upscaling is disabled by default; enable **Allow upscaling** when needed. All resize modes, thumbnails, previews, and exports use Pillow LANCZOS. The nearest-neighbor control has been removed, and the backend ignores `nearest` in older requests. The original resize script is bundled byte for byte as `python/resize_image.py` and verified against the SHA-256 recorded in `python/resize-source.json`; no external project folder is required. Its original `--nearest` definition remains intact, but the workbench never enables it. Default PNG processing for proportional height and square stretch calls its original `resize_png` entry point directly. Width, percentage, bounds, pad, crop, and non-square stretch are workbench adaptations in Python, not additional modes supplied by the original CLI. Other proportional results can also use the original entry point when their dimensions match its rules.

The browser handles interaction and display. Dimension plans, output naming, thumbnails, previews, and exports are handled by the local backend; no Canvas processing or frontend dimension algorithm remains. Proportional rounding follows Python's `.5` behavior. Existing tools and their files are left untouched.

Reducing pixel dimensions still removes detail. A thin outline can become less than one pixel at a very small target size. PNG optimization only reduces encoded bytes; it cannot restore detail lost during resizing.

## Lossless PNG optimization

When PNG is selected, **Optimize PNG losslessly** is checked by default. You can turn it off; the choice is remembered with your resize settings. The option is hidden for JPG/WebP and does not affect those formats.

The original resize entry point writes PNG with `optimize=True, compress_level=9`. Its encoded bytes are retained even when a baseline PNG would be no larger, ensuring the original result is not silently replaced by a different encoding. Activity identifies this case as original encoding with zero savings. Python-only adaptations use the same Pillow settings and accept a smaller candidate. Failed processing/optimization or the 30-second optimization timeout falls back to baseline PNG processing where available.

**256-color PNG palette · Lossy** is a separate optional switch matching the original script's `--palette`, off by default. It can change colors and transparency. Lossless PNG optimization only describes encoding after resizing and any requested palette conversion; it does not make resizing or palette conversion lossless.

Preview uses the same optimization path and shows the final encoded file size. Activity reports each file's before/after sizes and savings, plus total savings for files actually written in the batch. Skipped and failed exports do not count toward saved bytes.

A batch processes one image at a time. Stop cancels the active request and avoids writing a not-yet-exported image; files already saved remain in place. Closing a preview cancels its processing request. Optimization reduces file bytes; resizing itself still changes pixel information.

The previous OxiPNG files and [license notices](public/vendor/oxipng/NOTICE.md) are retained in the repository, but are no longer executed or served by the application.

## Folder watching and ordering

**Watch folder for changes** scans recursively every three seconds while the page is open. It adds or updates images, removes deleted files, and preserves existing selections. Watching pauses during export and does **not** automatically process or export images. Background tabs may be throttled; use **Refresh now** when needed. Closing the page stops scanning.

New arrivals and imports appear first, ordered by detection/import time descending. Files in the same batch are ordered by name, with numeric sorting. Existing files are ordered by modification time descending, then name. Old files copied into the folder still count as new arrivals. Deselecting an asset persists across refreshes; replacing a file preserves its selection and arrival time. Changing the input folder starts a fresh scan with existing files unselected.

Dropping a folder imports a snapshot. To keep it synchronized, load it as the asset folder. Non-image files, including `.meta` files, are ignored.

## Inputs, exports, and originals

- Default input: `./input`. Default output: `./output`. Relative paths resolve against this project's folder, regardless of the launch directory, so the project can be moved as a whole.
- Your explicit destination takes priority. An empty destination restores `./output`; missing folders are created automatically. Existing output folders are never cleared.
- Existing Python tools and their input/output remain separate and preserved.
- Input/output paths and watching preferences are stored in `settings.json`. Resize settings, theme, and language are stored in browser localStorage.
- Subfolder structure is preserved by default. Dropped/imported folders include their top-level folder name; watched assets use the selected folder as their root. Disable the option for flat output.
- Existing files receive `_1`, `_2`, etc. by default. You may choose **Skip** or explicitly choose **Overwrite destination**.
- Keep the destination outside the source folder. The server rejects writes into the loaded input folder. Browsers do not expose absolute source paths for dropped files, so choose a separate destination for those files, especially when overwriting.
- Import PNG, JPG, WebP, and BMP. Export PNG, WebP, or JPG with matching extensions. PNG/WebP preserve transparency; JPG uses a white background. WebP/JPG offer encoding-quality controls.

The service listens only on `127.0.0.1`, checks Host/Origin and request tokens, and validates paths and symbolic links. Batches process one image at a time. Limits: 80 MB per exported file, 16384 px per side, and approximately 32 million output pixels.

“Size” refers to pixel dimensions, not a target KB/MB file size. Animated GIF, TIFF, and Excel size mappings are not currently supported.

## Development and AI-assisted changes

The project uses native HTML, CSS, ES modules, Node.js built-in modules, and Python/Pillow. The browser displays images and uploads originals to the local service; it does not resize or encode output images with Canvas.

| File | Responsibility |
| --- | --- |
| `public/index.html` | Workspace, controls, and preview dialog; English fallback text. |
| `public/styles.css` | Shared layout and light/dark theme tokens. |
| `public/i18n.js` | English/Chinese catalog, language persistence, static labels, and error presentation. |
| `public/theme.js` | Theme restoration before the stylesheet and the header toggle. |
| `public/app.js` | Imports, selections, watching, previews, exports, and translated activity. |
| `public/library.mjs` | Asset reconciliation and ordering. |
| `public/resize.mjs` | Interface mode registry only. |
| `image-processor.mjs` | Python discovery, protocol/build checks, backend plans, and processing requests. |
| `python/resize_image.py` / `python/resize-source.json` | Byte-for-byte original script and its SHA-256 verification record. |
| `python/process_image.py` | Direct calls to the original resize function, Python mode adaptations, planning/naming, PNG/JPEG/WebP encoding, and fallback. |
| `public/vendor/oxipng/` | Retained legacy codec files and third-party notices; not served or executed. |
| `server.mjs` | Local image-processing/filesystem APIs and static serving. |
| `tests/core.test.mjs` | Resize, filesystem, and HTTP checks. |
| `tests/localization.test.mjs` | Language persistence, translation coverage, theme labels, and application state checks using a DOM stub. |
| `tests/backend.test.mjs` / `tests/python_image_test.py` | Real Python encoding, copied-tool pixel comparisons, transparency, PNG fallback, cancellation, and local API/export checks. |
| `tests/image-fixtures.mjs` | Image fixtures and independent PNG decoding for backend verification. |

For a future feature, start an AI conversation in this folder with a request such as:

> Read AGENTS.md and AI_GUIDE.md, then add a target-KB compression mode with preview and batch export. Keep existing output files and originals, and provide English and Chinese labels.

See [AI_GUIDE.md](AI_GUIDE.md) for extension steps and [AGENTS.md](AGENTS.md) for maintenance conventions. Add new user-facing text to `public/i18n.js`, then update both README versions when behavior changes.

## Verification and troubleshooting

```sh
npm test
```

Tests cover geometry, Python image processing, decoded pixels, path constraints, folder scans, collision policies, source protection, local API access, and language behavior. Filesystem tests use temporary directories. Browser verification should separately check previews, dimensions, transparency, exported files, and preservation of originals.

For the supplied `cardIcon.png` source, the original script's 150 × 150 LANCZOS/RGBA PNG and the workbench result were verified to have identical encoded bytes. A different appearance still requires checking the actual selected parameters and display scale; it is not evidence that the PNG algorithm differs. New comparisons should use the same original and settings, and inspect the result at 1:1.

Startup logs are in `.runtime/server.log` and `.runtime/server.error.log`. If all thumbnails fail to fetch and refreshing no longer opens the page, run **start.cmd** again and inspect `.runtime/server.error.log` if startup fails. A page opening by itself is not a successful image-processing check.

On Windows, Python discovery first starts a short-lived copy of the current Node executable to initialize child-process job handling. This avoids a known older-libuv failure involving Windows Store executable aliases (`AssignProcessToJobObject: (87)`; [upstream explanation](https://github.com/libuv/libuv/pull/4152)). It does not require upgrading the system Node installation or change the image-processing algorithm.

If port 4178 is occupied, choose another port:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Port 4179
```

For network folders, ensure your Windows account can access them. Per-file failures appear in **Activity** and do not stop subsequent files in the batch.

Technical references: [Pillow Image](https://pillow.readthedocs.io/en/stable/reference/Image.html), [Pillow image formats](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html), [Node.js filesystem](https://nodejs.org/api/fs.html).
