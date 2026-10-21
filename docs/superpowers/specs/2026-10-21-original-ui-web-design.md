# Original Concat UI in a browser

The user rejected the separately written HTML editor and any screen-streaming solution. Use the actual upstream `.slint` UI and existing Rust application behavior. Local use first. No VNC, remote desktop, or UI recreation.

Architecture to validate: compile the existing Slint component tree for WebAssembly. Keep native media, filesystem and Studio logic on localhost. Generate a typed property/callback transport from the existing Slint interfaces so the browser renders the original components and invokes the original Rust callbacks. Pure UI callbacks (translation, formatting, curves) execute locally and reuse original Rust implementations. The browser handles file selection/upload; the native side processes media. Transfer media frames/assets, never rendered application screenshots.

First acceptance gate is compiling and displaying the unchanged original start screen and new-project dialog in the browser. Next, open an actual project and exercise original import, timeline, inspector and export controls end to end. Do not label an inert UI or partial wiring a complete port.

Keep the prior web branch/data recoverable. Do not mutate unrelated projects or OS permissions. Bind the service to loopback and preserve request-origin checks. Build artifacts using the fork's CI if local disk prevents a full Rust build. State material native-only limitations honestly.
