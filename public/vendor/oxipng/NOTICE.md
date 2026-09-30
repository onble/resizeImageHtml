# OxiPNG browser codec

These unmodified, single-threaded files are vendored from `@jsquash/oxipng` **2.3.0**, already used by NineSliceCropper:

- `squoosh_oxipng.js`
- `squoosh_oxipng_bg.wasm` (164,172 bytes)

They run locally without npm installation, a build step, or a CDN. Source: [jSquash OxiPNG](https://github.com/jamsinclair/jSquash/tree/main/packages/oxipng), originally derived from [Squoosh](https://github.com/GoogleChromeLabs/squoosh).

The package uses Apache-2.0 (`LICENSE-APACHE.txt`); the underlying codec's distributed MIT notice is preserved in `LICENSE-MIT.txt` (Copyright 2016 Joshua Holmer). Keep both notices when redistributing or replacing these files.

WASM SHA-256: `5ea3e53c0b4fc1b4e8d1511d35b89329d9376bec75a9c4d3c054774487e5f9a3`.

The application calls `optimise(bytes, 2, false, false)`: level 2, no interlacing, and no rewriting colors under fully transparent pixels. Changes to codec versions or options require real PNG pixel verification.
