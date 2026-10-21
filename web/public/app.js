// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 PON Cut contributors
import { Timeline, activeTimeline, durationOf, timeLabel, escapeHTML as esc, snappedTime } from './timeline.js';

const $ = id => document.getElementById(id);
let projectId=null, view=null, selected=null, playhead=0, revision=0, busy=false;
let previewCache=null, renderJob=null, toastTimer, frameTimer, frameObjectURL;
let frameWanted=null, frameRunning=false, frameGeneration=0;
const timeline=new Timeline($('timeline-content'),{select:selectClip,seek,edit:command=>run(()=>edit(command)),isBusy:()=>busy||Boolean(renderJob),ripple:()=>$('ripple').checked});
const projectURL=()=>`/api/projects/${projectId}`;
const selectedClip=()=>activeTimeline(view)?.clips.find(c=>c.id===selected);

function toast(message, isError=false) {
  clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',isError);$('toast').hidden=false;
  toastTimer=setTimeout(()=>$('toast').hidden=true,isError?9000:3500);
}
async function api(url,body,method=body===undefined?'GET':'POST') {
  const response=await fetch(url,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();
  if (!response.ok) throw new Error(result.error||'ดำเนินการไม่สำเร็จ');
  return result;
}
async function run(action) {
  if (busy || renderJob) return;
  busy=true;document.body.classList.add('is-busy');updateButtons();
  try { return await action(); }
  catch(error) { toast(error.message,true);$('save-status').textContent='ตรวจสอบข้อความแจ้งเตือน'; }
  finally { busy=false;document.body.classList.remove('is-busy');updateButtons(); }
}
function updateButtons() {
  const locked=busy||Boolean(renderJob), hasProject=Boolean(view)&&!$('editor').hidden, hasClips=hasProject&&Boolean(activeTimeline(view)?.clips.length);
  for (const id of ['save-button','import-button','title-button','track-button']) $(id).disabled=!hasProject||locked;
  $('export-button').disabled=!hasClips||locked;$('play-button').disabled=!hasClips||locked;
  $('undo-button').disabled=!view?.canUndo||locked;$('redo-button').disabled=!view?.canRedo||locked;
  $('split-button').disabled=!selected||locked;$('delete-button').disabled=!selected||locked;
  $('projects-button').disabled=locked;$('new-project').disabled=locked;
  $('inspector-content').querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=locked);
}
function invalidatePreview() {
  revision++;previewCache=null;$('playback').pause();$('playback').hidden=true;$('playback').removeAttribute('src');$('playback').load();
  $('frame').hidden=!activeTimeline(view)?.clips.length;
}
function useState(result,{changed=true}={}) {
  view=result.view;projectId=result.id;
  if (changed) invalidatePreview();
  if (!selectedClip()) selected=null;
  const length=durationOf(activeTimeline(view));playhead=Math.min(playhead,length);
  $('project-name').textContent=view.settings.name;
  $('project-format').textContent=`${view.settings.width} × ${view.settings.height} · ${view.settings.rateNum/view.settings.rateDen} fps`;
  $('welcome').hidden=true;$('editor').hidden=false;
  $('save-status').textContent='บันทึกแล้ว';
  renderMedia();renderTimeline();renderInspector();updateButtons();requestFrame();
}
function renderTimeline() {
  const tl=activeTimeline(view);timeline.update(view,selected,playhead,Number($('zoom').value));
  $('total-time').textContent='/ '+timeLabel(durationOf(tl));$('playhead-time').textContent=timeLabel(playhead);
  $('clip-count').textContent=`${tl.clips.length} clips`;
}
function selectClip(id) {
  selected=id;timeline.setSelected(id);renderInspector();updateButtons();
  const clip=selectedClip();if (clip) {$('selection-status').textContent=clip.name||clip.kind;seek(Math.max(clip.start,Math.min(playhead,clip.start+clip.duration-0.01)));}
}
function seek(time,{fromVideo=false}={}) {
  if (!view) return;
  playhead=snappedTime(Math.min(Math.max(0,time),durationOf(activeTimeline(view))),view.settings.rateNum/view.settings.rateDen);
  timeline.setPlayhead(playhead);$('playhead-time').textContent=timeLabel(playhead);
  if (fromVideo) return;
  if (previewCache?.revision===revision && !$('playback').hidden) { $('playback').currentTime=playhead;return; }
  requestFrame();
}
function requestFrame() {
  clearTimeout(frameTimer);
  frameGeneration++;
  const hasClips=Boolean(activeTimeline(view)?.clips.length);
  $('stage-empty').hidden=hasClips;$('frame').hidden=!hasClips||!$('playback').hidden;
  if (!hasClips || !$('playback').hidden) { frameWanted=null;$('frame-loading').hidden=true;return; }
  frameTimer=setTimeout(()=>{frameWanted={url:projectURL()+`/frame?time=${playhead}`,generation:frameGeneration};pumpFrames();},130);
}
async function pumpFrames() {
  if (frameRunning) return;frameRunning=true;$('frame-loading').hidden=false;
  try {
    while(frameWanted) {
      const wanted=frameWanted;frameWanted=null;
      const response=await fetch(wanted.url);
      if (!response.ok) { const failure=await response.json();throw new Error(failure.error); }
      const blob=await response.blob();
      if (wanted.generation!==frameGeneration) continue;
      const next=URL.createObjectURL(blob);$('frame').src=next;
      if (frameObjectURL) URL.revokeObjectURL(frameObjectURL);frameObjectURL=next;
    }
  } catch(error) { toast('พรีวิว: '+error.message,true); }
  finally {frameRunning=false;$('frame-loading').hidden=true;}
}
async function edit(command) {
  $('save-status').textContent='กำลังบันทึก…';
  const result=await api(projectURL()+'/edit',{command});
  if (result.view.createdId && activeTimeline(result.view)?.clips.some(c=>c.id===result.view.createdId)) selected=result.view.createdId;
  useState(result);
}
async function openProject(id) {
  $('playback').pause();selected=null;playhead=0;
  useState(await api(`/api/projects/${id}`));localStorage.setItem('pon-cut-last-project',id);
}
async function showProjects() {
  $('playback').pause();$('welcome').hidden=false;$('editor').hidden=true;
  $('project-name').textContent='โปรเจกต์ของคุณ';
  const {projects}=await api('/api/projects');
  $('recent-projects').innerHTML=projects.length?projects.map(p=>`<button type="button" class="project-card" data-project="${esc(p.id)}"><span class="project-card-icon">↗</span><strong>${esc(p.name)}</strong><small>${p.width} × ${p.height} · ${p.fps} fps<br>${new Date(p.createdAt).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'})}</small></button>`).join(''):'<p class="muted">ยังไม่มีโปรเจกต์ — เริ่มจากคลิปแรกของคุณ</p>';
}
function renderMedia() {
  const media=view.project.media;$('media-count').textContent=media.length;
  const signature=projectId+':'+media.map(m=>m.id).join(',');
  if ($('media-list').dataset.signature===signature) return;
  $('media-list').dataset.signature=signature;
  $('media-list').innerHTML=media.length?media.map(item=>{
    const url=`${projectURL()}/media/${encodeURIComponent(item.id)}`;
    const thumb=item.kind==='image'?`<img src="${url}" loading="lazy" alt="" width="55" height="42">`:item.kind==='video'?`<video src="${url}#t=0.1" muted playsinline preload="metadata" width="55" height="42" aria-hidden="true"></video>`:'♫';
    return `<div class="media-card"><div class="media-thumb">${thumb}</div><div class="media-info"><strong title="${esc(item.name)}">${esc(item.name)}</strong><small>${esc(item.kind)} · ${item.duration?timeLabel(item.duration):'ภาพนิ่ง'}</small></div><button type="button" data-add-media="${esc(item.id)}" title="เพิ่ม ${esc(item.name)} ลงไทม์ไลน์" aria-label="เพิ่ม ${esc(item.name)} ลงไทม์ไลน์">＋</button></div>`;
  }).join(''):'<div class="media-empty">ไฟล์ของคุณจะอยู่ที่นี่<br>นำเข้าคลิปเพื่อเริ่มตัดต่อ</div>';
}
async function importFiles(files) {
  if (!files.length || !projectId) return;
  for (let index=0;index<files.length;index++) {
    const file=files[index];$('save-status').textContent=`นำเข้า ${index+1}/${files.length}…`;
    const result=await new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();xhr.open('POST',projectURL()+'/media?name='+encodeURIComponent(file.name));xhr.setRequestHeader('Content-Type','application/octet-stream');
      xhr.upload.onprogress=e=>{if(e.lengthComputable)$('save-status').textContent=`นำเข้า ${file.name} · ${Math.round(e.loaded/e.total*100)}%`;};
      xhr.onload=()=>{try{const value=JSON.parse(xhr.responseText);if(xhr.status!==200)reject(new Error(value.error));else resolve(value);}catch{reject(new Error('นำเข้าไฟล์ไม่สำเร็จ'));}};
      xhr.onerror=()=>reject(new Error('เชื่อมต่อขณะนำเข้าไฟล์ไม่ได้'));xhr.send(file);
    });
    useState(result);
  }
  toast(`นำเข้าแล้ว ${files.length} ไฟล์ — กด ＋ เพื่อเพิ่มลงไทม์ไลน์`);
}

function renderInspector() {
  const clip=selectedClip();$('clip-kind').textContent=clip?.kind||'';
  if (!clip) {$('inspector-content').innerHTML='<div class="inspector-empty"><span>⌖</span><p>เลือกคลิปบนไทม์ไลน์<br>เพื่อปรับรายละเอียด</p></div>';return;}
  const input=(label,name,value,min,max)=>`<label>${label}<input name="${name}" type="number" value="${Number(value)}" min="${min}" max="${max}" step="any" required></label>`;
  $('inspector-content').innerHTML=`<form id="clip-form"><div class="clip-name">${esc(clip.name||clip.kind)}</div>
    <h3>POSITION & DURATION</h3><div class="field-grid">${input('เริ่มที่ (วินาที)','start',clip.start,0,86400)}${input('ความยาว (วินาที)','duration',clip.duration,0.02,86400)}</div>
    <h3>PLAYBACK</h3><div class="field-grid">${input('ความเร็ว ×','speed',clip.speed,0.0625,16)}${input('เสียง %','volume',clip.volume*100,0,400)}</div>
    <h3>TRANSFORM</h3><div class="field-grid">${input('ขนาด %','scale',clip.scale*100,5,800)}${input('หมุน °','rotation',clip.rotation,-360,360)}</div><div class="field-grid">${input('แนวนอน %','offsetX',clip.offsetX*100,-300,300)}${input('แนวตั้ง %','offsetY',clip.offsetY*100,-300,300)}</div><div class="field-grid">${input('ความทึบ %','opacity',clip.opacity*100,0,100)}<label class="toggle"><input name="muted" type="checkbox" ${clip.muted?'checked':''}>ปิดเสียงคลิป</label></div>
    ${clip.kind==='text'?`<h3>TEXT</h3><label>ข้อความ<textarea name="content" rows="3" required maxlength="2000">${esc(clip.text?.content||'')}</textarea></label><div class="field-grid">${input('ขนาดตัวอักษร %','fontSize',(clip.text?.fontSize||0.09)*100,1,70)}<label>สี<input name="color" type="color" value="${esc(clip.text?.color||'#ffffff')}"></label></div>`:''}
    <button class="primary wide" type="submit">ใช้การปรับแต่ง</button>
    ${['video','image'].includes(clip.kind)?'<div class="inline-actions"><button type="button" data-frame="fit">Fit</button><button type="button" data-frame="fill">Fill</button><button type="button" data-flip>พลิก ↔</button></div>':''}
    </form>`;
  $('clip-form').addEventListener('submit',event=>{event.preventDefault();
    // Capture before run() disables editing controls: disabled fields are omitted by FormData.
    const data=new FormData(event.currentTarget);
    run(async()=>{
    const num=key=>Number(data.get(key));
    const commands=[];
    if (Math.abs(num('start')-clip.start)>0.005) commands.push({op:'moveClips',moves:[{clipId:clip.id,trackId:clip.trackId,start:num('start')}]});
    const speed=num('speed'),speedChanged=Math.abs(speed-clip.speed)>0.0001;
    if (speedChanged) commands.push({op:'setClipSpeed',clipId:clip.id,speed});
    if (Math.abs(num('duration')-clip.duration)>0.011) commands.push({op:'trimClip',clipId:clip.id,edge:'end',delta:num('duration')-(speedChanged?clip.duration*clip.speed/speed:clip.duration),ripple:$('ripple').checked});
    commands.push({op:'setClipTransform',clipId:clip.id,scale:num('scale')/100,rotation:num('rotation'),offsetX:num('offsetX')/100,offsetY:num('offsetY')/100});
    const patch={volume:num('volume')/100,opacity:num('opacity')/100,muted:data.has('muted')};
    if(clip.kind==='text')patch.text={...clip.text,content:data.get('content'),fontSize:num('fontSize')/100,color:data.get('color')};
    commands.push({op:'updateClip',clipId:clip.id,patch});
    await edit({op:'batch',commands});toast('ปรับแต่งและบันทึกแล้ว');
  });});
  $('inspector-content').querySelectorAll('[data-frame]').forEach(button=>button.addEventListener('click',()=>run(()=>edit({op:'frameClip',clipId:clip.id,framing:button.dataset.frame}))));
  $('inspector-content').querySelector('[data-flip]')?.addEventListener('click',()=>run(()=>edit({op:'updateClip',clipId:clip.id,patch:{flipH:!clip.flipH}})));
}

async function renderVideo(preview) {
  if (renderJob || !view) return;
  if(preview && previewCache?.revision===revision){showPlayback(previewCache.url);return;}
  $('render-label').textContent=preview?'PREPARE PLAYBACK':'EXPORT VIDEO';
  $('render-title').textContent=preview?'กำลังเตรียมพรีวิวพร้อมเสียง':'กำลังส่งออกวิดีโอ';
  $('render-description').textContent=preview?'เรนเดอร์พรีวิวขนาดเล็ก รวมเสียง ข้อความ และการตัดต่อทั้งหมด':'ส่งออก MP4 · H.264 + AAC · ขนาดตามโปรเจกต์';
  $('render-progress').value=0;$('render-percent').textContent='0%';$('render-stage').textContent='เตรียมงาน…';$('render-error').textContent='';$('download-button').hidden=true;$('cancel-render').hidden=false;$('render-close').disabled=true;
  $('render-dialog').showModal();
  const targetProject=projectId,targetRevision=revision;
  try {
    const result=await api(projectURL()+'/render',{preview});renderJob={job:result.job,project:targetProject};updateButtons();
    let status;
    while(renderJob){
      status=await api(`/api/projects/${targetProject}/jobs/${result.job}`);
      const fraction=Math.max(0,Math.min(1,status.fraction||0));
      $('render-progress').value=status.state==='done'?1:fraction;$('render-percent').textContent=Math.round((status.state==='done'?1:fraction)*100)+'%';
      const stages={video:'เรนเดอร์วิดีโอ',audio:'ประมวลผลเสียง',mux:'รวมภาพและเสียง',cutout:'ประมวลผลฉากหลัง',stabilize:'ประมวลผลภาพสั่น'};
      $('render-stage').textContent=stages[status.stage]||status.state;
      if(status.state!=='running')break;
      await new Promise(resolve=>setTimeout(resolve,350));
    }
    if(status.state==='done'){
      if(preview){previewCache={revision:targetRevision,url:status.url};$('render-dialog').close();showPlayback(status.url);}
      else{$('render-title').textContent='วิดีโอพร้อมแล้ว';$('render-description').textContent='ไฟล์ MP4 บันทึกไว้ในโฟลเดอร์โปรเจกต์แล้ว';$('download-button').href=status.url+'?download=1';$('download-button').hidden=false;$('render-stage').textContent='เสร็จสมบูรณ์';toast('ส่งออกวิดีโอสำเร็จ');}
    }else if(status.state==='cancelled'){$('render-title').textContent='ยกเลิกแล้ว';$('render-stage').textContent='การตัดต่อของคุณยังบันทึกอยู่';}
    else throw new Error(status.error?.message||status.error||'ส่งออกไม่สำเร็จ');
  }catch(error){$('render-error').textContent=error.message;$('render-title').textContent='ประมวลผลไม่สำเร็จ';}
  finally{renderJob=null;$('render-close').disabled=false;$('cancel-render').hidden=true;updateButtons();}
}
function showPlayback(url){
  const video=$('playback');video.src=url;video.hidden=false;$('frame').hidden=true;$('frame-loading').hidden=true;
  video.onloadedmetadata=()=>{video.currentTime=Math.min(playhead,Math.max(0,video.duration-.05));video.play().catch(()=>toast('กด ▶ บนวิดีโอเพื่อเล่น'));};
  $('preview-hint').textContent='พรีวิวพร้อมเสียง · แก้ไขแล้วจะเรนเดอร์ใหม่';
}

$('new-project').addEventListener('click',()=>{$('project-error').textContent='';$('project-dialog').showModal();$('project-title-input').focus();});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
$('project-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  const form=event.currentTarget,button=form.querySelector('button[type=submit]');button.disabled=true;
  try{const data=new FormData(form),[width,height]=data.get('format').split('x').map(Number);const result=await api('/api/projects',{name:data.get('name'),width,height,fps:Number(data.get('fps'))});selected=null;playhead=0;useState(result);localStorage.setItem('pon-cut-last-project',result.id);$('project-dialog').close();form.reset();}
  catch(error){$('project-error').textContent=error.message;}
  finally{button.disabled=false;}
});});
$('projects-button').addEventListener('click',()=>run(showProjects));
$('recent-projects').addEventListener('click',event=>{const card=event.target.closest('[data-project]');if(card)run(()=>openProject(card.dataset.project));});
$('import-button').addEventListener('click',()=>$('file-input').click());
$('file-input').addEventListener('change',event=>{const files=[...event.target.files];event.target.value='';run(()=>importFiles(files));});
const mediaPanel=document.querySelector('.media-panel');
for(const name of ['dragenter','dragover'])mediaPanel.addEventListener(name,event=>{event.preventDefault();mediaPanel.classList.add('drop-active');});
mediaPanel.addEventListener('dragleave',event=>{if(!mediaPanel.contains(event.relatedTarget))mediaPanel.classList.remove('drop-active');});
mediaPanel.addEventListener('drop',event=>{event.preventDefault();mediaPanel.classList.remove('drop-active');run(()=>importFiles([...event.dataTransfer.files]));});
window.addEventListener('dragover',event=>event.preventDefault());window.addEventListener('drop',event=>event.preventDefault());
$('media-list').addEventListener('click',event=>{const button=event.target.closest('[data-add-media]');if(button)run(()=>edit({op:'addClipAtFirstFree',mediaId:button.dataset.addMedia,start:durationOf(activeTimeline(view))}));});
$('save-button').addEventListener('click',()=>run(async()=>{useState(await api(projectURL()+'/save',{}),{changed:false});toast('บันทึกโปรเจกต์แล้ว');}));
for(const action of ['undo','redo'])$(action+'-button').addEventListener('click',()=>run(async()=>useState(await api(projectURL()+'/'+action,{}))));
function split(){if(selected)return edit({op:'splitClips',clipIds:[selected],time:playhead});}
function remove(){if(selected)return edit({op:'removeClips',clipIds:[selected],ripple:$('ripple').checked});}
$('split-button').addEventListener('click',()=>run(split));$('delete-button').addEventListener('click',()=>run(remove));
$('track-button').addEventListener('click',()=>run(()=>edit({op:'addTrack',bottom:false})));
$('title-button').addEventListener('click',()=>{$('title-dialog').showModal();$('title-form').elements.text.focus();});
$('title-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;run(async()=>{const data=new FormData(form);await edit({op:'addTextClip',above:true,start:playhead,duration:Number(data.get('duration')),offsetY:Number(data.get('offset')),style:{content:data.get('text'),fontFamily:'Thonburi',fontSize:.06,fontWeight:700,color:'#ffffff',strokeWidth:.003,strokeColor:'#000000'}});$('title-dialog').close();form.reset();});});
$('zoom').addEventListener('input',renderTimeline);
$('back-button').addEventListener('click',()=>seek(playhead-1));$('forward-button').addEventListener('click',()=>seek(playhead+1));
$('play-button').addEventListener('click',()=>run(()=>renderVideo(true)));
$('export-button').addEventListener('click',()=>run(()=>renderVideo(false)));
$('playback').addEventListener('timeupdate',()=>seek($('playback').currentTime,{fromVideo:true}));
$('render-close').addEventListener('click',()=>{if(!renderJob)$('render-dialog').close();});
$('render-dialog').addEventListener('cancel',event=>{if(renderJob||$('render-close').disabled)event.preventDefault();});
$('cancel-render').addEventListener('click',async()=>{if(!renderJob)return;try{await api(`/api/projects/${renderJob.project}/jobs/${renderJob.job}/cancel`,{});$('render-stage').textContent='กำลังยกเลิก…';}catch(error){$('render-error').textContent=error.message;}});
document.addEventListener('keydown',event=>{
  if(!view||$('editor').hidden||busy||renderJob||document.querySelector('dialog[open]')||event.target.closest('input,textarea,select'))return;
  const command=event.metaKey||event.ctrlKey;
  if(command&&event.key.toLowerCase()==='s'){event.preventDefault();$('save-button').click();}
  else if(command&&event.key.toLowerCase()==='z'){event.preventDefault();$(event.shiftKey?'redo-button':'undo-button').click();}
  else if(event.key.toLowerCase()==='s'&&!command){event.preventDefault();run(split);}
  else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();run(remove);}
  else if(event.key==='ArrowLeft'){event.preventDefault();seek(playhead-1/(view.settings.rateNum/view.settings.rateDen));}
  else if(event.key==='ArrowRight'){event.preventDefault();seek(playhead+1/(view.settings.rateNum/view.settings.rateDen));}
  else if(event.key===' '){event.preventDefault();if(!$('playback').hidden){$('playback').paused?$('playback').play():$('playback').pause();}else run(()=>renderVideo(true));}
});
window.addEventListener('resize',()=>{if(view)renderTimeline();});

async function boot(){
  try{await api('/api/health');$('engine-status').classList.add('ready');$('engine-status').innerHTML='<i></i>Engine พร้อมใช้งาน';}
  catch(error){$('engine-status').textContent='Engine ไม่พร้อม';toast(error.message,true);}
  try{await showProjects();}catch(error){toast(error.message,true);}
}
boot();
