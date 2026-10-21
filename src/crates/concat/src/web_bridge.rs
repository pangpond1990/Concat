// SPDX-License-Identifier: AGPL-3.0-or-later
//! Local data/action transport for the original Slint UI rendered in WASM.
//! Never transports a rendered application window. The browser renders it.
use std::io::{BufRead, Write};
use serde_json::{Value, json};
use crate::host::Shell;

#[path="../../../../web/bridge/wire.rs"] mod wire;
#[path="../../../../web/bridge/generated.rs"] mod generated;

pub fn enabled() -> bool {std::env::var_os("CONCAT_WEB_BRIDGE").is_some()}

pub fn start() {
    std::thread::spawn(|| {
        for line in std::io::stdin().lock().lines() {
            let Ok(line)=line else {break};
            let request:Value=match serde_json::from_str(&line) {Ok(v)=>v,Err(_)=>continue};
            let (tx,rx)=std::sync::mpsc::sync_channel(1);
            let id=request["id"].clone();
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
                                studio.handle(crate::panes::Msg::Media(crate::panes::media_bin::MediaMsg::Import(paths)));
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
                        let mut snapshot=generated::snapshot(&app);
                        let studio=shell.studio.borrow();
                        snapshot["__keybinds"]=json!(studio.prefs.keybinds);
                        snapshot["__capturing"]=json!(studio.settings.capturing.is_some());
                        Ok(snapshot)
                    })();
                });
                let _=tx.send(result);
            });
            if queued.is_err() {break;}
            let response=match rx.recv() {
                Ok(Ok(state))=>json!({"id":id,"result":state}),
                Ok(Err(message))=>json!({"id":id,"error":message}),
                Err(_)=>break,
            };
            let mut output=std::io::stdout().lock();
            if writeln!(output,"{response}").is_err() {break;}
            let _=output.flush();
        }
        let _=slint::quit_event_loop();
    });
}
