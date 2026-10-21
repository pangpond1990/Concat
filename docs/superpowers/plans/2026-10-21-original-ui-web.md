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
- [x] Inspect Slint exports and original synchronous helpers.
- [x] Create a WASM build entry that compiles the original UI sources directly.
- [x] Build and inspect start screen/new project dialog in browser.

### Task 2: Bind original logic
- [x] Generate typed state/callback bridge from Slint source interfaces.
- [x] Install localhost transport in native app behind a feature flag.
- [x] Reuse original pure helper code on the browser side.
- [x] Test a create/open/import/edit/export roundtrip using original callbacks.

### Task 3: Deliver
- [x] Verify original UI in Chrome, including actual editing and playback.
- [x] Document build/run, limits and provenance; push changes to fork.

## Final verification status

Completed on 22 October 2026 in Chrome. The installed final WASM event-loop
wakeup fix (4d5e7ba, Actions run 39556526595) updates the preview, timecode and
playhead after one Play click with no further pointer input, through the end
of the five-second test clip. Split and undo were rechecked successfully.
Earlier import, Thai title, saved-project reopen and fully decoded H.264/AAC
export checks also passed. This is a local initial port; advanced feature and
sustained frame-rate coverage remain limited as documented in the README.

The automation-created Chrome tab was blocked with ERR_BLOCKED_BY_CLIENT.
A normal tab opened by the user loaded the same localhost URL successfully;
no security settings were changed. The working tab was left open.
