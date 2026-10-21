// SPDX-License-Identifier: AGPL-3.0-or-later
// The browser compiles the actual upstream component tree, not a recreation.
use slint::ComponentHandle;
use wasm_bindgen::prelude::*;
mod ui { slint::include_modules!(); }
mod bridge;
mod font_data {include!(concat!(env!("OUT_DIR"),"/font_data.rs"));}
#[path="../../../src/crates/concat/src/fonts.rs"] mod fonts;
pub use bridge::{apply_snapshot,resize,pointer_down};
#[path="../../../src/crates/concat/src/focus.rs"] mod focus;
#[path="../../../src/crates/concat/src/keymap.rs"] mod keymap;
#[path="../../../src/crates/concat/src/speech_text.rs"] mod speech_text;
mod prefs { #[derive(Default)] pub struct Preferences { pub keybinds:std::collections::HashMap<String,String> } }
mod platform { pub fn keys(parts:&[&str])->String {parts.join("+")} pub fn delete_key(shift:bool)->String {if shift {"Shift+Delete"} else {"Delete"}.into()} }

#[path = "../../../src/crates/concat/src/format.rs"]
mod format;

// The original catalogue/lookup code runs in the browser. There are no local
// filesystem overlays in WASM; the original built-in language files still apply.
pub struct BrowserDirs { pub config: std::path::PathBuf }
#[path="../../../src/crates/concat/src/i18n.rs"] mod i18n;

#[wasm_bindgen(start)]
pub fn start() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    let app=ui::App::new().map_err(|e| JsValue::from_str(&e.to_string()))?;
    fonts::register();
    let words=app.global::<ui::I18n>();
    words.on_lookup(|_,key| i18n::t(&key).into());
    words.on_lookup1(|_,key,a| i18n::tf(&key,&[&a]).into());
    words.on_lookup2(|_,key,a,b| i18n::tf(&key,&[&a,&b]).into());
    words.on_lookup_upper(|_,key| i18n::t(&key).to_uppercase().into());
    app.global::<ui::Curves>().on_ease(format::bezier_y_at_x);
    app.global::<ui::Curves>().on_parse(|text,fallback| format::parse_bezier(&text,fallback));
    app.global::<ui::Fmt>().on_parse_timecode(|text| format::parse_timecode(&text));
    app.global::<ui::Fmt>().on_tick_interval(format::tick_interval);
    app.global::<ui::Fmt>().on_parse_frames(|text,rate| format::parse_frames(&text,rate));
    app.global::<ui::Fmt>().on_hex_of(|value,alpha| if alpha {format::hex_rgba(value)} else {format::hex_of(value)}.into());
    app.global::<ui::Fmt>().on_hex_digits(|value| format::hex_of(value)[1..].into());
    app.global::<ui::Fmt>().on_color_of(|text,fallback| format::parse_colour(&text).unwrap_or(fallback));
    bridge::bind(&app);
    app.set_app_version("0.2.8 · browser port validation".into());
    app.run().map_err(|e| JsValue::from_str(&e.to_string()))
}
