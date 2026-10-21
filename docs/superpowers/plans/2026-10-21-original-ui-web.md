# Original UI Web Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run the actual upstream Concat UI in the browser with the existing native editing logic.
**Architecture:** Slint WebAssembly frontend, generated state/callback bridge to the original native Studio, localhost file/media adapters. No recreated editor or screen streaming.
**Tech Stack:** Existing Rust/Slint 1.18, wasm-bindgen, Node localhost service, GitHub Actions.
**Spec:** docs/superpowers/specs/2026-10-21-original-ui-web-design.md

## Global Constraints
- Actual upstream .slint components, no manually rebuilt UI.
- Browser rendering, no VNC or screenshots as the UI.
- Local use; original projects remain recoverable.

## Review Focus
- Pure callbacks must stay synchronous in the browser.
- UI changes must reach original Rust actions and return changed state.
- Media image values must remain usable in browser rendering.
- Native filesystem pickers must become browser uploads without exposing arbitrary paths.
- Compilation or resource constraints must not be disguised as completion.

### Task 1: Validate original UI WebAssembly build
- [ ] Inspect Slint exports and original synchronous helpers.
- [ ] Create a WASM build entry that compiles the original UI sources directly.
- [ ] Build and inspect start screen/new project dialog in browser.

### Task 2: Bind original logic
- [ ] Generate typed state/callback bridge from Slint source interfaces.
- [ ] Install localhost transport in native app behind a feature flag.
- [ ] Reuse original pure helper code on the browser side.
- [ ] Test a create/open/import/edit/export roundtrip using original callbacks.

### Task 3: Deliver
- [ ] Verify original UI in Chrome, including actual editing and playback.
- [ ] Document build/run, limits and provenance; push changes to fork.
