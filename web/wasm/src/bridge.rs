// SPDX-License-Identifier: AGPL-3.0-or-later
use slint::ComponentHandle;
use wasm_bindgen::prelude::*;
use serde_json::{Value,json};
use crate::ui::*;
#[path="../../bridge/wire.rs"] pub mod wire;
#[path="../../bridge/generated.rs"] mod generated;
use wire::Wire;
thread_local! {
 static APP: std::cell::RefCell<Option<App>>=const {std::cell::RefCell::new(None)};
 static APPLYING: std::cell::Cell<bool>=const {std::cell::Cell::new(false)};
 static KEYBINDS: std::cell::RefCell<crate::prefs::Preferences>=Default::default();
 static MACOS: std::cell::Cell<bool>=const {std::cell::Cell::new(false)};
 static CAPTURING: std::cell::Cell<bool>=const {std::cell::Cell::new(false)};
}
#[wasm_bindgen(inline_js="export function original_ui_event(value) { window.dispatchEvent(new CustomEvent('concat-ui', { detail: value })); }")]
extern "C" { fn original_ui_event(value:&str); }
pub fn emit(name:&str,args:Vec<Value>) {
 if !APPLYING.with(|v|v.get()) {original_ui_event(&json!({"name":name,"args":args}).to_string());}
}

pub fn bind(app:&App) {
 generated::bind(app);
 // These are synchronous browser operations, not network round trips.
 let weak=app.as_weak();
 app.global::<Focus>().on_release(move || {if let Some(app)=weak.upgrade(){app.invoke_blur();}});
 use slint::private_unstable_api::re_exports::DataTransfer;
 app.global::<Payload>().on_of(DataTransfer::from);
 app.global::<Payload>().on_text(|value|value.plain_text().unwrap_or_default());
 app.global::<Payload>().on_pane_seat(|text|text.strip_prefix("pane:").and_then(|s|s.split(':').next()).and_then(|s|s.parse().ok()).unwrap_or(-1));
 app.global::<Payload>().on_tab_index(|text|text.strip_prefix("tab:").and_then(|s|s.split(':').next()).and_then(|s|s.parse().ok()).unwrap_or(-1));
 let weak=app.as_weak();
 app.global::<Editor>().on_blur(move || {if let Some(app)=weak.upgrade(){app.invoke_blur();}});
 app.global::<Editor>().on_key_chord(|text,shift,alt,mut control,mut meta,on_start| {
  if MACOS.with(|v|v.get()) && meta && !control {control=true;meta=false;}
  let capturing=CAPTURING.with(|c|c.get());
  let handled=capturing || (!on_start && crate::keymap::chord(&text,shift,alt,control,meta)
    .is_some_and(|chord|KEYBINDS.with(|p|crate::keymap::resolve(&p.borrow(),&chord).is_some())));
  if handled {emit("Editor.key-chord",vec![text.wire(),shift.wire(),alt.wire(),control.wire(),meta.wire(),on_start.wire()]);}
  handled
 });
 app.on_speech_insert_tag(|text,tag,at|crate::speech_text::insert_tag(&text,&tag,at.max(0) as usize).into());
 APP.with(|slot|*slot.borrow_mut()=Some(app.clone_strong()));
}
#[wasm_bindgen]
pub fn apply_snapshot(text:&str)->Result<(),JsValue> {
 let value:Value=serde_json::from_str(text).map_err(|e|JsValue::from_str(&e.to_string()))?;
 if let Some(macos)=value.get("App.macos").and_then(Value::as_bool) {MACOS.with(|v|v.set(macos));}
 if let Some(keys)=value.get("__keybinds") {KEYBINDS.with(|p|p.borrow_mut().keybinds=serde_json::from_value(keys.clone()).unwrap_or_default());}
 if let Some(capture)=value.get("__capturing").and_then(Value::as_bool) {CAPTURING.with(|c|c.set(capture));}
 if let Some(lang)=value.get("I18n.lang").and_then(Value::as_str) {
  crate::i18n::select(lang,&crate::BrowserDirs{config:Default::default()});
 }
 APPLYING.with(|v|v.set(true));
 let result=APP.with(|slot|slot.borrow().as_ref().ok_or("UI is not ready".to_string()).and_then(|app|generated::apply(app,&value)));
 APPLYING.with(|v|v.set(false));
 result.map_err(|e|JsValue::from_str(&e))
}
#[wasm_bindgen]
pub fn resize(width:f32,height:f32) {
 APP.with(|slot|if let Some(app)=slot.borrow().as_ref(){app.window().set_size(slint::LogicalSize::new(width.max(900.0),height.max(560.0)));});
}

#[wasm_bindgen]
pub fn pointer_down(x:f32,y:f32) {
 APP.with(|slot|if let Some(app)=slot.borrow().as_ref(){if crate::focus::press_misses_focused_input(app.window(),x,y){app.invoke_blur();}});
}
