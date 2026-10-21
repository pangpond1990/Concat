# Concat original UI — browser port (in development)

This branch replaces the earlier separately written HTML editor approach.
The browser compiles `src/crates/concat/ui/app.slint` with Slint's WebAssembly
backend. Every panel, dialog, layout, icon and style is the upstream component
itself. There is no remote desktop or application screenshot transport.

The native process keeps the original Rust `Studio`, callback registrations,
project operations, media engine and undo history. `web/bridge/generate.py`
generates typed transport for the public Slint state and actions. Browser UI
callbacks invoke the existing native callbacks; state changes return to the
browser's own components. Native frame/thumbnail images are media assets,
not pictures of the application interface.

Pure formatting, Bézier curves, keyboard parsing, text insertion and translation
reuse the original Rust helpers. Model updates preserve row identity so a native
state update does not destroy an active browser pointer gesture.

## Build

- Browser: `cd web/wasm && cargo build --release --target wasm32-unknown-unknown`,
  then run the matching `wasm-bindgen --target web --out-dir pkg` on
  `target/wasm32-unknown-unknown/release/concat_browser.wasm`.
- Native: install the dependencies in `src/README.md`, then
  `cd src && cargo build -p concat --profile quick --features web-bridge`.
- CI: `Original UI WebAssembly` and `Original UI native host` on this branch
  produce downloadable artifacts. This avoids large local Rust build directories.

## Run

Place browser artifacts in `web/wasm/pkg/` and the native host in
`vendor/browser-host/concat`, with its libraries in `vendor/browser-host/lib/`.
Keep an empty `vendor/browser-host/portable/` directory to isolate settings and
recents from the installed desktop app. Then:

```sh
node web/original/server.mjs
```

Open `http://127.0.0.1:4317`. `CONCAT_WEB_BINARY`, `CONCAT_WEB_DATA` and `PORT`
configure the host binary, import storage and local port. Imported files are
copied into `web/original-data/imports/`; original files are untouched.

The server binds only to loopback and refuses cross-origin requests. It is
intended for one person on this Mac, not public hosting or multiple independent
editing sessions. Tabs share the native application session.

## Validation status

This is a port under active development. Successful compilation alone does not
establish that every desktop interaction works in the browser. The native smoke
check exercises the actual upstream start/create/title/undo callbacks:

```sh
node web/original/smoke.mjs /absolute/path/to/bridge-enabled/concat
```

Browser checks must additionally cover media import, pointer dragging/trimming,
keyboard shortcuts, preview playback and an actual export.

Audio processing and device playback currently run on the local Mac through the
original engine. Browser remote audio, microphone capture and native self-updates
are not yet adapted. Project/output folder dialogs accept paths on this Mac;
media file selection uses a browser file picker and upload to the local host.
