// SPDX-License-Identifier: AGPL-3.0-or-later
// The browser compiles the actual upstream component tree, not a recreation.
use slint::ComponentHandle;
use wasm_bindgen::prelude::*;
mod ui { slint::include_modules!(); }

#[path = "../../../src/crates/concat/src/format.rs"]
mod format;

mod i18n {
    use std::collections::HashMap;
    use std::sync::OnceLock;
    pub fn t(key: &str) -> String {
        static WORDS: OnceLock<HashMap<String, serde_json::Value>> = OnceLock::new();
        WORDS.get_or_init(|| serde_json::from_str(include_str!("../../../src/crates/concat/locales/en.json")).unwrap())
            .get(key).and_then(|v| v.as_str()).unwrap_or(key).to_string()
    }
    pub fn tf(key: &str, args: &[&dyn std::fmt::Display]) -> String {
        let mut value=t(key);
        for (i,arg) in args.iter().enumerate() { value=value.replace(&format!("{{{i}}}"), &arg.to_string()); }
        value
    }
}

#[wasm_bindgen(start)]
pub fn start() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    let app=ui::App::new().map_err(|e| JsValue::from_str(&e.to_string()))?;
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
    app.set_app_version("0.2.8 · browser port validation".into());
    app.run().map_err(|e| JsValue::from_str(&e.to_string()))
}
