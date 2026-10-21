// SPDX-License-Identifier: AGPL-3.0-or-later
// Browser I/O only. Editing UI and behavior come from upstream Slint/Rust.
import init,{apply_snapshot,resize,pointer_down} from './pkg/concat_browser.js';
const $=id=>document.getElementById(id),client=crypto.randomUUID();
let activePicker=null,actions=Promise.resolve(),noticeTimer;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function notice(message,link){clearTimeout(noticeTimer);$('notice').textContent=message;if(link){const a=document.createElement('a');a.textContent=link.label;a.href=link.href;if(link.download)a.download='';else {a.target='_blank';a.rel='noopener';}$('notice').append(a);}$('notice').hidden=false;noticeTimer=setTimeout(()=>$('notice').hidden=true,link?30000:8000);}
async function api(url,body){const response=await fetch(url,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error);return result;}
$('canvas').addEventListener('pointerdown',event=>pointer_down(event.offsetX,event.offsetY),true);
window.addEventListener('concat-ui',event=>{const action=JSON.parse(event.detail);actions=actions.then(()=>api('/api/action',action)).catch(error=>notice(error.message));});
async function stateLoop(){while(true){try{const state=await api('/api/state?client='+client);apply_snapshot(JSON.stringify(state));$('status').hidden=true;}catch(error){notice(error.message);}await delay(document.hidden?1000:80);}}
async function eventsLoop(){while(true){try{for(const event of await api('/api/events')){
 if(['files','folder','save'].includes(event.kind)){
  activePicker=event;$('picker-title').textContent=event.title;$('picker-status').textContent='';$('picker-files').value='';
  $('file-label').hidden=event.kind!=='files';$('path-label').hidden=event.kind==='files';
  $('picker-files').accept=event.extensions.map(ext=>'.'+ext).join(',');
  $('picker-path').value=event.kind==='save'?event.start.replace(/\/$/,'')+'/'+event.name:event.start;
  $('picker').showModal();
 }else if(event.kind==='reveal'){notice(event.path,event.download?{label:'Download',href:event.download,download:true}:null);}
 else if(event.kind==='link'&&/^https?:\/\//.test(event.url)){notice('Open link',{label:event.url,href:event.url});}
 }}catch(error){notice(error.message);}await delay(250);}}
async function cancelPicker(){if(!activePicker)return;const picker=activePicker.id;activePicker=null;$('picker').close();await api('/api/picker',{picker,paths:null});}
$('picker-cancel').onclick=()=>cancelPicker().catch(e=>notice(e.message));
$('picker').addEventListener('cancel',event=>{event.preventDefault();cancelPicker().catch(e=>notice(e.message));});
$('picker-form').onsubmit=async event=>{event.preventDefault();if(!activePicker)return;const picker=activePicker.id;const button=event.submitter;button.disabled=true;try{
 let paths=[];if(activePicker.kind==='files'){
  for(const file of $('picker-files').files){$('picker-status').textContent='Importing '+file.name+'…';const response=await fetch('/api/upload?name='+encodeURIComponent(file.name),{method:'POST',body:file,headers:{'Content-Type':'application/octet-stream'}});const result=await response.json();if(!response.ok)throw new Error(result.error);paths.push(result.path);}
  if(!paths.length)throw new Error('Choose at least one file');
 }else {const value=$('picker-path').value.trim();if(!value.startsWith('/'))throw new Error('Enter an absolute path on this Mac');paths=[value];}
 await api('/api/picker',{picker,paths});activePicker=null;$('picker').close();
 }catch(error){$('picker-status').textContent=error.message;}finally{button.disabled=false;}};
try{await init();const fit=()=>resize(innerWidth,innerHeight);fit();window.addEventListener('resize',fit);stateLoop();eventsLoop();}
catch(error){$('status').textContent='Could not load the original interface: '+error.message;}

window.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
window.addEventListener('drop',async event=>{
 if(!event.dataTransfer.types.includes('Files'))return;
 event.preventDefault();
 try{
  const paths=[];
  for(const file of event.dataTransfer.files){
   notice('Importing '+file.name+'…');
   const response=await fetch('/api/upload?name='+encodeURIComponent(file.name),{method:'POST',body:file,headers:{'Content-Type':'application/octet-stream'}});
   const result=await response.json();if(!response.ok)throw new Error(result.error);paths.push(result.path);
  }
  if(paths.length)await api('/api/drop',{paths});
 }catch(error){notice(error.message);}
});
