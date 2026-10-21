// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 PON Cut contributors
export const TRACK_LABEL_WIDTH = 110;
export function activeTimeline(view) {
  return view?.project.timelines.find(t => t.id === view.project.activeTimelineId);
}
export function durationOf(timeline) {
  return Math.max(0, ...(timeline?.clips || []).map(c => c.start + c.duration));
}
export function timeLabel(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  return `${String(minutes).padStart(2,'0')}:${(value % 60).toFixed(2).padStart(5,'0')}`;
}
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function snappedTime(time, fps) {
  return Math.max(0, Math.round(time * fps) / fps);
}

/** The DOM is a view of the native timeline; edits are submitted as commands. */
export class Timeline {
  constructor(root, { select, seek, edit, isBusy, ripple }) {
    this.root = root;
    this.select = select; this.seek = seek; this.edit = edit; this.isBusy = isBusy; this.ripple = ripple;
    root.addEventListener('pointerdown', e => this.pointerDown(e));
    root.addEventListener('pointermove', e => this.pointerMove(e));
    root.addEventListener('pointerup', e => this.pointerUp(e));
    root.addEventListener('pointercancel', () => { this.drag = null; this.render(); });
    root.addEventListener('keydown', e => {
      const clip = e.target.closest('[data-clip]');
      if (clip && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault();this.select(clip.dataset.clip); }
    });
  }
  update(view, selected, playhead, zoom) {
    this.view=view;this.timeline=activeTimeline(view);this.selected=selected;this.playhead=playhead;this.zoom=zoom;
    this.render();
  }
  setPlayhead(time) {
    this.playhead=time;
    const line=this.root.querySelector('.playhead');
    if (line) line.style.left=`${TRACK_LABEL_WIDTH + time*this.zoom}px`;
  }
  setSelected(id) {
    this.selected=id;
    this.root.querySelectorAll('[data-clip]').forEach(el=>el.classList.toggle('selected',el.dataset.clip===id));
  }
  render() {
    if (!this.timeline) return;
    const length=Math.max(15,durationOf(this.timeline)+3);
    const width=Math.max(this.root.parentElement.clientWidth,TRACK_LABEL_WIDTH+length*this.zoom+30);
    this.root.style.width=`${width}px`;
    const tick=this.zoom<30?5:this.zoom<70?2:1;
    let html='<div class="ruler" aria-label="คลิกเพื่อเลื่อนตำแหน่งเล่น">';
    for (let s=0;s<=(width-TRACK_LABEL_WIDTH)/this.zoom;s+=tick) html+=`<span class="ruler-label" style="left:${TRACK_LABEL_WIDTH+s*this.zoom}px">${timeLabel(s).slice(0,-3)}</span>`;
    html+='</div>';
    this.tracks=[...this.timeline.tracks].reverse(); // engine stores bottom first
    this.tracks.forEach((track,index)=>{
      html+=`<div class="track-row" data-track="${escapeHTML(track.id)}"><div class="track-label"><small>${String(this.tracks.length-index).padStart(2,'0')}</small>Track ${this.tracks.length-index}</div>`;
      for (const clip of this.timeline.clips.filter(c=>c.trackId===track.id)) {
        html+=`<button type="button" class="timeline-clip ${escapeHTML(clip.kind)} ${clip.id===this.selected?'selected':''}" data-clip="${escapeHTML(clip.id)}" style="left:${TRACK_LABEL_WIDTH+clip.start*this.zoom}px;width:${Math.max(8,clip.duration*this.zoom)}px" title="${escapeHTML(clip.name||clip.kind)} · ${timeLabel(clip.start)} → ${timeLabel(clip.start+clip.duration)}"><span class="trim-handle start" data-edge="start"></span><strong>${escapeHTML(clip.kind==='text'?'T '+clip.text?.content:clip.name||clip.kind)}</strong><small>${clip.duration.toFixed(2)}s</small><span class="trim-handle end" data-edge="end"></span></button>`;
      }
      html+='</div>';
    });
    if (!this.timeline.clips.length) html+='<div class="timeline-empty">ไทม์ไลน์ว่าง — เพิ่มไฟล์จาก Media เพื่อเริ่มตัดต่อ</div>';
    html+=`<div class="playhead" style="left:${TRACK_LABEL_WIDTH+this.playhead*this.zoom}px"></div>`;
    this.root.innerHTML=html;
  }
  pointerDown(event) {
    if (event.button!==0 || this.isBusy()) return;
    const element=event.target.closest('[data-clip]');
    const x=event.clientX-this.root.getBoundingClientRect().left;
    if (!element) {
      if (x>=TRACK_LABEL_WIDTH) { this.seek((x-TRACK_LABEL_WIDTH)/this.zoom);this.drag={kind:'seek'};this.root.setPointerCapture(event.pointerId); }
      return;
    }
    event.preventDefault();
    const clip=this.timeline.clips.find(c=>c.id===element.dataset.clip);
    this.select(clip.id);
    this.drag={kind:event.target.dataset.edge||'move',clip,element,startX:event.clientX,startY:event.clientY,delta:0,targetTrack:clip.trackId};
    this.root.setPointerCapture(event.pointerId);
  }
  pointerMove(event) {
    const drag=this.drag;if (!drag) return;
    if (drag.kind==='seek') { this.seek((event.clientX-this.root.getBoundingClientRect().left-TRACK_LABEL_WIDTH)/this.zoom);return; }
    const fps=this.view.settings.rateNum/this.view.settings.rateDen;
    drag.delta=Math.round((event.clientX-drag.startX)/this.zoom*fps)/fps;
    if (drag.kind==='move') {
      const start=snappedTime(drag.clip.start+drag.delta,fps);
      drag.element.style.left=`${TRACK_LABEL_WIDTH+start*this.zoom}px`;
      const y=event.clientY-this.root.getBoundingClientRect().top;
      const row=Math.max(0,Math.min(this.tracks.length-1,Math.floor((y-27)/56)));
      drag.targetTrack=this.tracks[row].id;
      const original=this.tracks.findIndex(t=>t.id===drag.clip.trackId);
      drag.element.style.transform=`translateY(${(row-original)*56}px)`;
      drag.element.style.zIndex='6';
    } else if (drag.kind==='end') {
      drag.element.style.width=`${Math.max(8,(drag.clip.duration+drag.delta)*this.zoom)}px`;
    } else {
      drag.element.style.left=`${TRACK_LABEL_WIDTH+Math.max(0,drag.clip.start+drag.delta)*this.zoom}px`;
      drag.element.style.width=`${Math.max(8,(drag.clip.duration-drag.delta)*this.zoom)}px`;
    }
  }
  pointerUp(event) {
    const drag=this.drag;if (!drag) return;this.drag=null;
    if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
    if (drag.kind==='seek') return;
    this.render();
    if (Math.abs(event.clientX-drag.startX)<3 && Math.abs(event.clientY-drag.startY)<3) return;
    if (drag.kind==='move') {
      this.edit({op:'moveClips',moves:[{clipId:drag.clip.id,start:Math.max(0,drag.clip.start+drag.delta),trackId:drag.targetTrack}]});
    } else {
      this.edit({op:'trimClip',clipId:drag.clip.id,edge:drag.kind,delta:drag.delta,ripple:this.ripple()});
    }
  }
}
