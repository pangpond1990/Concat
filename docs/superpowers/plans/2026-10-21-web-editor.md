# PON Cut Web Editor Implementation Plan

> Execute inline using superpowers:executing-plans, with a fresh review of the final branch.

**Goal:** Open and use the fork's native video editor engine from a local browser.

**Architecture:** Node HTTP server owns managed project folders and communicates with the released Concat engine over MCP stdio. Vanilla browser modules render authoritative engine state and submit editing commands. Engine-rendered frames and MP4 previews preserve the actual output.

**Tech Stack:** Node.js 22, HTML/CSS/JavaScript, Concat 0.2.8 headless MCP, Node test runner.

**Spec:** ../specs/2026-10-21-web-editor-design.md

## Global constraints

- Loopback only; files and computation remain on this Mac.
- Preserve native engine semantics and project format.
- No browser-supplied paths; retain licenses; distinct PON Cut branding.
- No runtime npm dependencies. Thai UI, keyboard accessible controls.

## Review focus

- Invalid/aborted uploads must not leave imported garbage (adapter test).
- Cross-origin requests and traversal must not access local files (HTTP test).
- Restarts and undo must preserve editable projects (real-engine test).
- Rendered preview/export must reflect trimming and title edits with audio (real-engine test plus ffprobe).
- Engine failure must surface an actionable error rather than hanging (transport test).

## Task 1: Engine transport and managed HTTP adapter

Files: web/engine.mjs, web/server.mjs, web/test/*.test.mjs, web/package.json.
Interfaces: Engine.call(name, args) returns MCP structured result; createApp({dataDir,engine}) returns an HTTP server. Routes use project UUIDs and allowlisted commands, never client paths.

- [x] Write and run failing adapter/transport tests.
- [x] Implement startup, framing, error handling, scoped projects/imports/edits/frames/jobs/downloads.
- [x] Run adapter tests and real engine create/import/edit/save/reopen/render checks.

## Task 2: Browser editor

Files: web/public/index.html, styles.css, app.js, timeline.js.
Interfaces: adapter routes under /api; engine project/settings/canUndo/canRedo are authoritative. Browser holds selection and playhead only.

- [x] Implement projects, import, timeline, inspector, undo/redo and save.
- [x] Implement engine frame scrubbing, prepared playback and export progress/download.
- [x] Verify browser import, split, trim, title, undo, reopen and export.

## Task 3: Delivery and review

Files: web/README.md, web/scripts/setup-engine.mjs, Start PON Cut.command, root README link, .gitignore and CI.

- [x] Add reproducible engine setup with checksum verification and local launcher.
- [x] Run the whole web test suite and source inventory checks; document native Rust test availability.
- [x] Review final diff, fix material findings, commit and push feature branch to fork.
- [x] Leave app running locally and report URL, fork, usage and limitations.
