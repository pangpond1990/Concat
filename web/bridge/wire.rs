// SPDX-License-Identifier: AGPL-3.0-or-later
//! Values crossing the original Slint UI's native/browser boundary.
use serde_json::{Value, json};
use slint::{Model, ModelRc, VecModel};
use base64::Engine;
pub type Result<T> = std::result::Result<T, String>;
pub trait Wire { fn wire(&self)->Value; fn update(&mut self,value:&Value)->Result<()>; }
impl Wire for () { fn wire(&self)->Value { Value::Null } fn update(&mut self,_:&Value)->Result<()> {Ok(())} }
macro_rules! number { ($($t:ty),*) => {$ (impl Wire for $t {
 fn wire(&self)->Value {json!(self)}
 fn update(&mut self,v:&Value)->Result<()> { *self=v.as_f64().filter(|v|v.is_finite()).ok_or("expected finite number")? as $t; Ok(()) }
})*}; }
number!(i32,i64,f32,f64);
impl Wire for bool { fn wire(&self)->Value {json!(self)} fn update(&mut self,v:&Value)->Result<()> {*self=v.as_bool().ok_or("expected bool")?;Ok(())} }
impl Wire for slint::SharedString { fn wire(&self)->Value {json!(self.as_str())} fn update(&mut self,v:&Value)->Result<()> {*self=v.as_str().ok_or("expected string")?.into();Ok(())} }
impl Wire for slint::Color {
 fn wire(&self)->Value {json!(self.as_argb_encoded())}
 fn update(&mut self,v:&Value)->Result<()> { *self=Self::from_argb_encoded(v.as_u64().ok_or("expected color")? as u32);Ok(()) }
}
impl Wire for slint::Brush {
 fn wire(&self)->Value {self.color().wire()}
 fn update(&mut self,v:&Value)->Result<()> {let mut c=self.color();c.update(v)?;*self=c.into();Ok(())}
}
impl<T:Wire+Clone+Default+PartialEq+'static> Wire for ModelRc<T> {
 fn wire(&self)->Value {Value::Array(self.iter().map(|v|v.wire()).collect())}
 fn update(&mut self,v:&Value)->Result<()> {
  let rows=v.as_array().ok_or("expected model array")?;
  if self.as_any().downcast_ref::<VecModel<T>>().is_none() {*self=std::rc::Rc::new(VecModel::<T>::default()).into();}
  let model=self.as_any().downcast_ref::<VecModel<T>>().ok_or("model is not mutable")?;
  // Same row-diff contract as original Studio::sync: preserve TouchAreas mid-drag.
  for (i,value) in rows.iter().enumerate() {
   let old=model.row_data(i);let mut next=old.clone().unwrap_or_default();next.update(value)?;
   if let Some(old)=old {if old!=next {model.set_row_data(i,next);}} else {model.push(next);}
  }
  while model.row_count()>rows.len() {model.remove(model.row_count()-1);}
  Ok(())
 }
}
#[cfg(not(target_arch="wasm32"))]
thread_local! {static IMAGES:std::cell::RefCell<std::collections::VecDeque<(slint::Image,Value)>>=Default::default();}
#[cfg(target_arch="wasm32")]
thread_local! {static DECODED:std::cell::RefCell<std::collections::VecDeque<(String,slint::Image)>>=Default::default();}
impl Wire for slint::Image {
 fn wire(&self)->Value {
  #[cfg(not(target_arch="wasm32"))] {
   use image::ImageEncoder;
   if self.size().width==0 || self.size().height==0 {return Value::Null;}
   IMAGES.with(|cache| {
    let mut cache=cache.borrow_mut();
    if let Some((_,v))=cache.iter().find(|(image,_)|image==self) {return v.clone();}
    let value=if let Some(pixels)=self.to_rgba8() {
     let mut png=Vec::new();
     match image::codecs::png::PngEncoder::new(&mut png).write_image(pixels.as_bytes(),pixels.width(),pixels.height(),image::ExtendedColorType::Rgba8) {
      Ok(())=>json!({"png":base64::engine::general_purpose::STANDARD.encode(png)}),Err(_)=>Value::Null
     }
    } else {Value::Null};
    if cache.len()>=128 {cache.pop_front();}
    cache.push_back((self.clone(),value.clone()));value
   })
  }
  #[cfg(target_arch="wasm32")] {Value::Null}
 }
 fn update(&mut self,v:&Value)->Result<()> {
  if v.is_null() {*self=Self::default();return Ok(());}
  let encoded=v.get("png").and_then(Value::as_str).ok_or("expected image")?;
  #[cfg(target_arch="wasm32")]
  if let Some(image)=DECODED.with(|cache|cache.borrow().iter().find(|(key,_)|key==encoded).map(|(_,image)|image.clone())) {*self=image;return Ok(());}
  let bytes=base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|e|e.to_string())?;
  let pixels=image::load_from_memory_with_format(&bytes,image::ImageFormat::Png).map_err(|e|e.to_string())?.into_rgba8();
  *self=Self::from_rgba8(slint::SharedPixelBuffer::<slint::Rgba8Pixel>::clone_from_slice(pixels.as_raw(),pixels.width(),pixels.height()));
  #[cfg(target_arch="wasm32")]
  DECODED.with(|cache|{let mut cache=cache.borrow_mut();if cache.len()>=128 {cache.pop_front();}cache.push_back((encoded.to_owned(),self.clone()));});
  Ok(())
 }
}
