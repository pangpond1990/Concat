// SPDX-License-Identifier: AGPL-3.0-or-later
//! Local data/action transport for the original Slint UI rendered in WASM.
//! Never transports a rendered application window. The browser renders it.
use std::io::{BufRead, Write};
use serde_json::{Value, json};
use crate::host::Shell;

#[path="../../../../web/bridge/wire.rs"] mod wire;
#[path="../../../../web/bridge/generated.rs"] mod generated;

pub fn enabled() -> bool {std::env::var_os("CONCAT_WEB_BRIDGE").is_some()}

type PickSender=std::sync::mpsc::SyncSender<Option<Vec<std::path::PathBuf>>>;
static EVENTS:std::sync::Mutex<Vec<Value>>=std::sync::Mutex::new(Vec::new());
static PICKS:std::sync::Mutex<Vec<(u64,PickSender)>>=std::sync::Mutex::new(Vec::new());
static PICK_ID:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(1);
pub fn event(value:Value) { EVENTS.lock().unwrap().push(value); }
pub fn pick(kind:&str,title:&str,start:&str,name:&str,extensions:&[&str])->Option<Vec<std::path::PathBuf>> {
 let id=PICK_ID.fetch_add(1,std::sync::atomic::Ordering::Relaxed);
 let (tx,rx)=std::sync::mpsc::sync_channel(1);
 PICKS.lock().unwrap().push((id,tx));
 event(json!({"kind":kind,"id":id,"title":title,"start":start,"name":name,"extensions":extensions}));
 rx.recv().ok().flatten()
}
fn answer(id:Value,result:Result<Value,String>) {
 let response=match result { Ok(result)=>json!({"id":id,"result":result}),Err(error)=>json!({"id":id,"error":error}) };
 let mut out=std::io::stdout().lock();let _=writeln!(out,"{response}");let _=out.flush();
}
pub fn start() {
    std::thread::spawn(|| {
        for line in std::io::stdin().lock().lines() {
            let Ok(line)=line else {break};
            let request:Value=match serde_json::from_str(&line) {Ok(v)=>v,Err(_)=>continue};
            let id=request["id"].clone();
            if request["method"]=="events" {
                answer(id,Ok(json!(std::mem::take(&mut *EVENTS.lock().unwrap()))));continue;
            }
            if request["method"]=="picker_reply" {
                let wanted=request["picker"].as_u64().unwrap_or(0);
                let mut picks=PICKS.lock().unwrap();
                if let Some(index)=picks.iter().position(|(id,_)|*id==wanted) {
                    let (_,tx)=picks.remove(index);
                    let paths=request["paths"].as_array().map(|paths|paths.iter().filter_map(Value::as_str).map(std::path::PathBuf::from).collect());
                    let _=tx.send(paths);
                }
                answer(id,Ok(Value::Null));continue;
            }
            let queued=slint::invoke_from_event_loop(move || {
                let mut result=Err("UI not ready".to_string());
                Shell::with(|shell,app| {
                    result=(|| {
                        match request["method"].as_str().unwrap_or("") {
                            "snapshot" => {},
                            "invoke" => {
                                generated::invoke(&app,request["name"].as_str().ok_or("missing callback")?,request["args"].as_array().ok_or("missing arguments")?)?;
                            },
                            "import" => {
                                let paths=request["paths"].as_array().ok_or("missing paths")?.iter()
                                    .map(|v|v.as_str().map(std::path::PathBuf::from).ok_or("invalid path".to_string())).collect::<Result<Vec<_>,_>>()?;
                                let mut studio=shell.studio.borrow_mut();
                                let to_library=studio.sounds.shown && !paths.is_empty() && paths.iter().all(|p|concat_host::sounds::is_sound(p));
                                if studio.on_start {studio.handle(crate::panes::Msg::Start(crate::panes::start::StartMsg::Dropped(paths)));}
                                else if to_library {studio.handle(crate::panes::Msg::Sounds(crate::panes::sounds::SoundsMsg::Import(paths)));}
                                else {studio.handle(crate::panes::Msg::Media(crate::panes::media_bin::MediaMsg::Import(paths)));}
                                studio.refresh_art();studio.publish(&app,&shell.models);
                            },
                            "open" => {
                                let path=request["path"].as_str().ok_or("missing project path")?;
                                let mut studio=shell.studio.borrow_mut();
                                studio.handle(crate::panes::Msg::Start(crate::panes::start::StartMsg::OpenChosen(path.into())));
                                studio.refresh_art();studio.publish(&app,&shell.models);
                            },
                            _ => return Err("unknown bridge method".into()),
                        }
                        if request["method"]!="snapshot" {return Ok(Value::Null);}
                        let mut snapshot=generated::snapshot(&app);
                        let studio=shell.studio.borrow();
                        snapshot["__keybinds"]=json!(studio.prefs.keybinds);
                        snapshot["__capturing"]=json!(studio.settings.capturing.is_some());
                        Ok(snapshot)
                    })();
                });
                answer(id,result);
            });
            if queued.is_err() {break;}

        }
        let _=slint::quit_event_loop();
    });
}
