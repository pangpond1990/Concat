// ─── Concat Web Studio — Frontend Application ────────────────────────────────
// Connects to the native Concat Engine MCP bridge in `web/server.mjs`
// and speaks the exact `concat_project::Command` & `Project` schema.

const ACCENT_MAP = {
  lime: { accent: "#cbf53f", soft: "#232a17", border: "#9ec22f", ink: "#12130f" },
  sky: { accent: "#5fb8ff", soft: "#142433", border: "#4490cc", ink: "#0e1318" },
  violet: { accent: "#b394ff", soft: "#221c33", border: "#8b6ecc", ink: "#121018" },
  rose: { accent: "#ff6fa3", soft: "#331823", border: "#cc527e", ink: "#180e12" },
  amber: { accent: "#ffb340", soft: "#332412", border: "#cc8b2c", ink: "#18120c" },
  mint: { accent: "#3fdcc4", soft: "#122e29", border: "#2cb09c", ink: "#0c1816" },
};

const SHAPE_TEMPLATES = [
  { id: "square", name: "Square (สี่เหลี่ยม)", kind: "square", fill: "#cbf53f", icon: "▭" },
  { id: "circle", name: "Circle (วงกลม)", kind: "circle", fill: "#5fb8ff", icon: "◯" },
  { id: "triangle", name: "Triangle (สามเหลี่ยม)", kind: "triangle", fill: "#b394ff", icon: "▲" },
  { id: "arrow", name: "Arrow Pointer (ลูกศร)", kind: "arrow", fill: "#3fdcc4", icon: "➜" },
  { id: "parallelogram", name: "Banner Slant (ป้ายเฉียง)", kind: "parallelogram", fill: "#ffb340", icon: "▱" },
  { id: "trapezoid", name: "Trapezoid (คางหมู)", kind: "trapezoid", fill: "#ff6fa3", icon: "⏢" },
  { id: "line", name: "Divider Line (เส้นคั่น)", kind: "line", fill: "#ffffff", icon: "━" },
];

const ADJUST_PRESETS = [
  {
    id: "concat.vivid",
    name: "Vivid Pop (สีสดคมชัด)",
    desc: "เร่งสีสันและคอนทราสต์ให้ภาพดูโดดเด่นทันตา",
  },
  {
    id: "concat.warm",
    name: "Warm Golden (โทนอุ่นแสงทอง)",
    desc: "เพิ่มบรรยากาศอบอุ่นนุ่มนวลสไตล์ Golden Hour",
  },
  {
    id: "concat.cool",
    name: "Cool Cinema (โทนเย็นภาพยนตร์)",
    desc: "โทนสีฟ้า-ครามสไตล์ภาพยนตร์ไซไฟ",
  },
  {
    id: "concat.noir",
    name: "B&W Film Noir (ขาวดำคอนทราสต์สูง)",
    desc: "ขาวดำคลาสสิกเน้นแสงและเงา",
  },
  {
    id: "concat.vintage",
    name: "Vintage 35mm (ฟิล์มวินเทจ)",
    desc: "ยกเงาดำขึ้นพร้อมเกรนและโทนย้อนยุค",
  },
  {
    id: "concat.vignette",
    name: "Soft Vignette (ขอบมืดโฟกัสกลางภาพ)",
    desc: "ดึงสายตาเข้าสู่จุดกึ่งกลางเฟรม",
  },
];

// ─── Global Application State ────────────────────────────────────────────────
const state = {
  lang: "th",
  theme: "dark",
  accent: "lime",
  catalog: { effects: [], filters: [], transitions: [], audio: [] },
  textPresets: [],
  projects: [],
  projectPath: null,
  view: null, // EditorView { project, canUndo, canRedo, settings, createdId }
  libraryTab: "media",
  mediaFilter: "all",
  librarySearch: "",
  selectedClipId: null,
  inspectorTab: "transform",
  playheadSec: 0,
  isPlaying: false,
  pxPerSec: 65,
  snapEnabled: true,
  rippleEnabled: false,
  previewScale: 0.5,
  previewBusy: false,
  pendingPreviewSec: null,
  lastRenderedKey: "",
  waveforms: new Map(), // mediaId -> number[]
  audioPreviewEl: new Audio(),
  activeExportJobId: null,
  exportPollTimer: null,
};

const $ = (id) => document.getElementById(id);

function showToast(msg, kind = "info") {
  const container = $("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast";
  const dotColor =
    kind === "error" ? "var(--red)" : kind === "success" ? "var(--green)" : "var(--accent)";
  el.innerHTML = `<span class="toast-dot" style="background:${dotColor}"></span><span>${escapeHtml(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.2s";
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getFps() {
  const tl = getActiveTimeline();
  const v = tl?.video || state.view?.settings || { rateNum: 30, rateDen: 1 };
  const num = Number(v.rateNum) || 30;
  const den = Number(v.rateDen) || 1;
  return Math.max(1, Math.round(num / den));
}

function formatTimecode(sec, fps = getFps()) {
  const s = Math.max(0, Number(sec) || 0);
  const totalFrames = Math.floor(s * fps + 1e-4);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

function formatShortDuration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}:${String(rem).padStart(2, "0")}`;
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// ─── Active Project & Timeline Accessors ─────────────────────────────────────
function getProject() {
  return state.view?.project || null;
}

function getActiveTimeline() {
  const proj = getProject();
  if (!proj || !Array.isArray(proj.timelines) || proj.timelines.length === 0) return null;
  const activeId = proj.activeTimelineId;
  return proj.timelines.find((t) => t.id === activeId) || proj.timelines[0];
}

function getTracks() {
  const tl = getActiveTimeline();
  return tl?.tracks || [];
}

function getAllClips() {
  const tl = getActiveTimeline();
  return tl?.clips || [];
}

function getClipsForTrack(trackId) {
  return getAllClips().filter((c) => c.trackId === trackId);
}

function getSelectedClip() {
  if (!state.selectedClipId) return null;
  return getAllClips().find((c) => c.id === state.selectedClipId) || null;
}

function getTimelineDuration() {
  const clips = getAllClips();
  let maxEnd = 0;
  for (const c of clips) {
    const end = (Number(c.start) || 0) + (Number(c.duration) || 0);
    if (end > maxEnd) maxEnd = end;
  }
  return Math.max(maxEnd, 5);
}

function getMediaById(mediaId) {
  const proj = getProject();
  if (!proj || !mediaId) return null;
  return (proj.media || []).find((m) => m.id === mediaId) || null;
}

// ─── Engine Command Dispatcher (`edit_apply`) ────────────────────────────────
async function dispatchCommand(command, toastMsg = null) {
  if (!state.projectPath) return null;
  try {
    $("saveBadge").textContent = "saving...";
    const res = await api("/api/edit", {
      method: "POST",
      body: JSON.stringify({ path: state.projectPath, command }),
    });
    if (res.view) {
      state.view = res.view;
      if (res.createdId || res.view.createdId) {
        const cid = res.createdId || res.view.createdId;
        if (String(cid).startsWith("c")) {
          state.selectedClipId = cid;
        }
      }
    }
    $("saveBadge").textContent = "saved";
    if (toastMsg) showToast(toastMsg, "success");
    renderStudio();
    requestEngineFrame(true);
    return res.view;
  } catch (err) {
    $("saveBadge").textContent = "error";
    showToast(`คำสั่งไม่สำเร็จ: ${err.message}`, "error");
    return null;
  }
}

// ─── Bootstrap & Launch Screen ───────────────────────────────────────────────
async function initApp() {
  bindGlobalEvents();
  try {
    const data = await api("/api/bootstrap");
    if (data.catalog) {
      state.catalog = data.catalog;
    } else if (Array.isArray(data.effects)) {
      state.catalog = {
        effects: data.effects.filter((e) => e.kind === "effect"),
        filters: data.effects.filter((e) => e.kind === "filter"),
        transitions: data.effects.filter((e) => e.kind === "transition"),
        audio: data.effects.filter((e) => e.kind === "audio"),
      };
    }
    state.textPresets = data.textPresets || [];
    state.projects = data.projects || [];

    const totalFx =
      (state.catalog.effects?.length || 0) +
      (state.catalog.filters?.length || 0) +
      (state.catalog.transitions?.length || 0) +
      (state.catalog.audio?.length || 0);
    const ver = data.version?.concat || "0.2.8";
    $("engineVersionText").textContent =
      `Concat v${ver} Native Engine Ready · ${totalFx} GPU Shaders, Filters & Audio DSP`;

    renderLaunchScreen();
  } catch (err) {
    $("engineVersionText").textContent = `Engine Error: ${err.message}`;
    showToast(`เชื่อมต่อ Engine ไม่สำเร็จ: ${err.message}`, "error");
  }
}

function renderLaunchScreen() {
  $("launchScreen").hidden = false;
  $("studioWorkspace").hidden = true;
  $("projectHeaderBox").hidden = true;
  $("btnOpenExport").hidden = true;

  const grid = $("projectsGrid");
  const q = ($("launchSearchInput")?.value || "").trim().toLowerCase();
  const filtered = state.projects.filter((p) => !q || (p.name || "").toLowerCase().includes(q));

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;min-height:180px">
        <div class="empty-state-icon">🎬</div>
        <div style="font-size:13px;font-weight:600;color:var(--fg)">ยังไม่มีโปรเจกต์ในรายการ</div>
        <div>คลิกปุ่ม <strong>"เปิดโปรเจกต์ตัวอย่างพร้อมตัดต่อ"</strong> หรือ <strong>"สร้างโปรเจกต์ใหม่"</strong> ด้านบนเพื่อเริ่มต้นทันที</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered
    .map((p) => {
      const w = p.width || 1920;
      const h = p.height || 1080;
      const fps = Math.round((p.rateNum || 30) / (p.rateDen || 1));
      return `
        <article class="project-card" data-open-path="${escapeHtml(p.path)}">
          <div class="project-card-thumb">
            <img src="/assets/editor-dark.png" alt="" style="width:100%;height:100%;object-fit:cover;opacity:0.82" />
            <span class="project-card-badge">${w}×${h} · ${fps}fps</span>
          </div>
          <div class="project-card-body">
            <div class="project-card-name">${escapeHtml(p.name || "Untitled")}</div>
            <div class="project-card-meta">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.path.split("/").slice(-2).join("/"))}</span>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  grid.querySelectorAll("[data-open-path]").forEach((card) => {
    card.addEventListener("click", async () => {
      const p = card.getAttribute("data-open-path");
      try {
        const res = await api("/api/project/open", {
          method: "POST",
          body: JSON.stringify({ path: p }),
        });
        openProjectIntoStudio(res.path, res.view);
      } catch (err) {
        showToast(`เปิดโปรเจกต์ไม่สำเร็จ: ${err.message}`, "error");
      }
    });
  });
}

function openProjectIntoStudio(projectPath, view) {
  state.projectPath = projectPath;
  state.view = view;
  state.playheadSec = 0;
  state.isPlaying = false;

  const clips = getAllClips();
  state.selectedClipId = clips.length > 0 ? clips[0].id : null;

  $("launchScreen").hidden = true;
  $("studioWorkspace").hidden = false;
  $("projectHeaderBox").hidden = false;
  $("btnOpenExport").hidden = false;

  renderStudio();
  fitStageAspect();
  requestEngineFrame(true);
}

// ─── Render Studio (All 4 Panes) ─────────────────────────────────────────────
function renderStudio() {
  const proj = getProject();
  if (!proj) return;

  const projName = state.view?.settings?.name || proj.name || state.projectPath?.split("/").pop() || "Untitled";
  $("projectNameInput").value = projName;
  $("btnUndo").disabled = !state.view?.canUndo;
  $("btnRedo").disabled = !state.view?.canRedo;

  const tl = getActiveTimeline();
  const videoCfg = tl?.video || state.view?.settings || { width: 1920, height: 1080, rateNum: 30, rateDen: 1 };
  const fps = getFps();
  $("monitorSpecLabel").textContent = `${videoCfg.width} × ${videoCfg.height} · ${fps} fps`;

  const ratioVal = `${videoCfg.width}x${videoCfg.height}`;
  if ($("aspectRatioSelect").querySelector(`option[value="${ratioVal}"]`)) {
    $("aspectRatioSelect").value = ratioVal;
  }

  $("btnMagneticToggle").classList.toggle("active", state.rippleEnabled);
  $("btnSnapToggle").classList.toggle("active", state.snapEnabled);

  updateTimecodeDisplay();
  renderLibraryPane();
  renderInspectorPane();
  renderTimelinePane();
  updateStageGizmo();
}

// ─── 1. Library Pane ─────────────────────────────────────────────────────────
function renderLibraryPane() {
  const proj = getProject();
  if (!proj) return;

  document.querySelectorAll("#libraryNav .lib-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === state.libraryTab);
  });

  $("mediaSidebar").hidden = state.libraryTab !== "media";
  $("btnImportMedia").hidden = state.libraryTab !== "media";

  const mediaList = proj.media || [];
  $("countAll").textContent = mediaList.length;
  $("countVideo").textContent = mediaList.filter((m) => m.kind === "video").length;
  $("countAudio").textContent = mediaList.filter((m) => m.kind === "audio" && m.origin !== "speech").length;
  $("countImage").textContent = mediaList.filter((m) => m.kind === "image").length;
  $("countSpeech").textContent = mediaList.filter((m) => m.origin === "speech").length;

  document.querySelectorAll("#mediaSidebar .media-filter-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === state.mediaFilter);
  });

  const grid = $("libraryGrid");
  const q = state.librarySearch.trim().toLowerCase();

  if (state.libraryTab === "media") {
    const filtered = mediaList.filter((m) => {
      if (state.mediaFilter === "video" && m.kind !== "video") return false;
      if (state.mediaFilter === "audio" && (m.kind !== "audio" || m.origin === "speech")) return false;
      if (state.mediaFilter === "image" && m.kind !== "image") return false;
      if (state.mediaFilter === "speech" && m.origin !== "speech") return false;
      if (q && !(m.name || "").toLowerCase().includes(q)) return false;
      return true;
    });

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-state-icon">📁</div>
          <div>ยังไม่มีไฟล์มีเดียในหมวดนี้</div>
          <div style="font-size:11px">คลิก <strong>"นำเข้าไฟล์ (Import)"</strong> หรือลากไฟล์วิดีโอ/เพลง/รูปภาพมาวางที่นี่</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered
      .map((m) => {
        const thumbHtml =
          m.kind === "video" || m.kind === "image"
            ? `<img src="/api/media-thumb?file=${encodeURIComponent(m.path)}" alt="${escapeHtml(m.name)}" loading="lazy" />`
            : `<span style="font-size:24px">${m.origin === "speech" ? "🗣️" : "🎵"}</span>`;
        return `
          <div class="lib-card" data-add-media="${escapeHtml(m.id)}" title="คลิกเพื่อวาง ${escapeHtml(m.name)} ลงไทม์ไลน์">
            <div class="lib-card-thumb">
              ${thumbHtml}
              <span class="lib-card-badge">${formatShortDuration(m.duration || 5)}</span>
              <span class="lib-card-add">＋</span>
            </div>
            <div class="lib-card-title">${escapeHtml(m.name)}</div>
          </div>
        `;
      })
      .join("");

    grid.querySelectorAll("[data-add-media]").forEach((el) => {
      el.addEventListener("click", () => {
        const mediaId = el.getAttribute("data-add-media");
        const m = getMediaById(mediaId);
        if (!m) return;
        dispatchCommand(
          {
            op: "addClipAtFirstFree",
            mediaId: m.id,
            start: state.playheadSec,
          },
          `เพิ่ม ${m.name} ลงไทม์ไลน์แล้ว`,
        );
      });
    });
    return;
  }

  if (state.libraryTab === "text") {
    const items = state.textPresets.filter(
      (t) =>
        !q ||
        (t.name || "").toLowerCase().includes(q) ||
        (t.style?.content || "").toLowerCase().includes(q),
    );
    grid.innerHTML = items
      .map((t) => {
        const st = t.style || {};
        const bg = st.background || "transparent";
        return `
          <div class="lib-card" data-add-text="${escapeHtml(t.id)}">
            <div class="lib-card-thumb" style="background:#141418;padding:6px;text-align:center">
              <span style="font-size:13px;font-weight:${st.fontWeight || 700};color:${st.color || "#fff"};background:${bg};padding:2px 6px;border-radius:4px;max-width:95%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${escapeHtml(st.content || t.name)}
              </span>
              <span class="lib-card-badge">${escapeHtml(t.language || "Text")}</span>
              <span class="lib-card-add">＋</span>
            </div>
            <div class="lib-card-title">${escapeHtml(t.name)}</div>
          </div>
        `;
      })
      .join("");

    grid.querySelectorAll("[data-add-text]").forEach((el) => {
      el.addEventListener("click", () => {
        const tpl = state.textPresets.find((t) => t.id === el.getAttribute("data-add-text"));
        if (!tpl) return;
        dispatchCommand(
          {
            op: "addTextClip",
            trackId: null,
            above: true,
            start: state.playheadSec,
            duration: 4.0,
            offsetY: tpl.offsetY ?? 0,
            style: tpl.style,
          },
          `เพิ่มข้อความ "${tpl.name}" แล้ว`,
        );
      });
    });
    return;
  }

  if (state.libraryTab === "shapes") {
    const items = SHAPE_TEMPLATES.filter((s) => !q || s.name.toLowerCase().includes(q));
    grid.innerHTML = items
      .map(
        (s) => `
        <div class="lib-card" data-add-shape="${escapeHtml(s.id)}">
          <div class="lib-card-thumb">
            <span style="font-size:28px;color:${s.fill}">${s.icon}</span>
            <span class="lib-card-add">＋</span>
          </div>
          <div class="lib-card-title">${escapeHtml(s.name)}</div>
        </div>
      `,
      )
      .join("");

    grid.querySelectorAll("[data-add-shape]").forEach((el) => {
      el.addEventListener("click", () => {
        const tpl = SHAPE_TEMPLATES.find((s) => s.id === el.getAttribute("data-add-shape"));
        if (!tpl) return;
        dispatchCommand(
          {
            op: "addShapeClip",
            trackId: null,
            above: true,
            start: state.playheadSec,
            duration: 4.0,
            name: tpl.name,
            style: {
              kind: tpl.kind,
              size: 0.35,
              fill: tpl.fill,
              stroke: "#ffffff",
              strokeWidth: 0.01,
            },
          },
          `เพิ่มรูปทรง ${tpl.name} แล้ว`,
        );
      });
    });
    return;
  }

  if (state.libraryTab === "adjust") {
    grid.innerHTML = ADJUST_PRESETS.map(
      (p) => `
        <div class="lib-card" data-apply-adjust="${escapeHtml(p.id)}" style="grid-column:1/-1">
          <div style="padding:10px;display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div>
              <div style="font-weight:700;color:var(--fg);font-size:12px">🎚️ ${escapeHtml(p.name)}</div>
              <div style="font-size:11px;color:var(--fg-muted);margin-top:2px">${escapeHtml(p.desc)}</div>
            </div>
            <span class="btn" style="padding:3px 8px;font-size:11px">＋ Layer</span>
          </div>
        </div>
      `,
    ).join("");

    grid.querySelectorAll("[data-apply-adjust]").forEach((el) => {
      el.addEventListener("click", () => {
        const preset = ADJUST_PRESETS.find((p) => p.id === el.getAttribute("data-apply-adjust"));
        if (!preset) return;
        dispatchCommand(
          {
            op: "addLayerClip",
            trackId: null,
            start: state.playheadSec,
            duration: 5.0,
            effectId: preset.id,
            name: preset.name,
          },
          `เพิ่ม Adjustment Layer "${preset.name}" แล้ว`,
        );
      });
    });
    return;
  }

  // Catalog-driven tabs: effects, filters, transitions, audio
  const catalogList = state.catalog[state.libraryTab] || [];
  const filtered = catalogList.filter(
    (item) =>
      !q ||
      (item.name || "").toLowerCase().includes(q) ||
      (item.id || "").toLowerCase().includes(q) ||
      (item.category || "").toLowerCase().includes(q),
  );

  const iconMap = {
    effects: "✨",
    filters: "🎨",
    transitions: "🔀",
    audio: "🔊",
  };

  grid.innerHTML = filtered
    .map(
      (item) => `
      <div class="lib-card" data-catalog-id="${escapeHtml(item.id)}" data-catalog-name="${escapeHtml(item.name)}" title="${escapeHtml(item.name)}">
        <div class="lib-card-thumb" style="background:linear-gradient(135deg,#1d1d22,#2a2a33)">
          <span style="font-size:20px">${iconMap[state.libraryTab] || "✨"}</span>
          <span class="lib-card-badge">${escapeHtml(item.category || state.libraryTab)}</span>
          <span class="lib-card-add">＋</span>
        </div>
        <div class="lib-card-title">${escapeHtml(item.name)}</div>
      </div>
    `,
    )
    .join("");

  grid.querySelectorAll("[data-catalog-id]").forEach((el) => {
    el.addEventListener("click", async () => {
      const id = el.getAttribute("data-catalog-id");
      const name = el.getAttribute("data-catalog-name") || id;
      const sel = getSelectedClip();

      if (!sel && (state.libraryTab === "effects" || state.libraryTab === "filters")) {
        await dispatchCommand(
          {
            op: "addLayerClip",
            trackId: null,
            start: state.playheadSec,
            duration: 4.0,
            effectId: id,
            name,
          },
          `สร้างเลเยอร์ "${name}" บนไทม์ไลน์แล้ว`,
        );
        return;
      }

      if (!sel) {
        showToast("กรุณาคลิกเลือกคลิปบนไทม์ไลน์ก่อนใช้งาน", "error");
        return;
      }

      if (state.libraryTab === "effects" || state.libraryTab === "filters") {
        const existing = Array.isArray(sel.videoEffects) ? [...sel.videoEffects] : [];
        if (!existing.some((fx) => fx.id === id)) {
          existing.push({ id, enabled: true, params: {} });
        }
        await dispatchCommand(
          { op: "updateClip", clipId: sel.id, patch: { videoEffects: existing } },
          `เพิ่ม "${name}" ลงในคลิปแล้ว`,
        );
      } else if (state.libraryTab === "transitions") {
        await dispatchCommand(
          {
            op: "updateClip",
            clipId: sel.id,
            patch: { transitionIn: { id, duration: 0.6, params: {} } },
          },
          `ตั้งค่าทรานซิชัน "${name}" แล้ว`,
        );
      } else if (state.libraryTab === "audio") {
        const existing = Array.isArray(sel.filters) ? [...sel.filters] : [];
        if (!existing.some((fx) => fx.id === id)) {
          existing.push({ id, enabled: true, params: {} });
        }
        await dispatchCommand(
          { op: "updateClip", clipId: sel.id, patch: { filters: existing } },
          `เพิ่มเอฟเฟกต์เสียง "${name}" แล้ว`,
        );
      }
    });
  });
}

// ─── 2. Preview Monitor & Stage Gizmo ────────────────────────────────────────
function fitStageAspect() {
  const wrap = $("monitorStageWrap");
  const stage = $("monitorStage");
  if (!wrap || !stage) return;

  const tl = getActiveTimeline();
  const videoCfg = tl?.video || state.view?.settings || { width: 1920, height: 1080 };
  const targetRatio = (videoCfg.width || 1920) / (videoCfg.height || 1080);

  const rect = wrap.getBoundingClientRect();
  const maxW = Math.max(200, rect.width - 28);
  const maxH = Math.max(140, rect.height - 28);

  let w = maxW;
  let h = w / targetRatio;
  if (h > maxH) {
    h = maxH;
    w = h * targetRatio;
  }
  stage.style.width = `${Math.round(w)}px`;
  stage.style.height = `${Math.round(h)}px`;
  updateStageGizmo();
}

async function requestEngineFrame(force = false) {
  if (!state.projectPath || !getProject()) return;
  const clips = getAllClips();
  const img = $("engineFrameImg");
  const emptyHint = $("stageEmptyHint");

  if (clips.length === 0) {
    img.hidden = true;
    emptyHint.hidden = false;
    return;
  }

  const key = `${state.projectPath}:${state.playheadSec.toFixed(3)}:${state.previewScale}`;
  if (!force && key === state.lastRenderedKey) return;

  if (state.previewBusy) {
    state.pendingPreviewSec = state.playheadSec;
    return;
  }

  state.previewBusy = true;
  const tl = getActiveTimeline();
  const videoCfg = tl?.video || state.view?.settings || { width: 1920, height: 1080 };
  const w = Math.max(320, Math.round((videoCfg.width || 1920) * state.previewScale));
  const h = Math.max(180, Math.round((videoCfg.height || 1080) * state.previewScale));
  const tSec = state.playheadSec;

  const url = `/api/preview?path=${encodeURIComponent(state.projectPath)}&time=${tSec.toFixed(3)}&width=${w}&height=${h}${force ? `&t=${Date.now()}` : ""}`;

  const preloader = new Image();
  preloader.onload = () => {
    img.src = preloader.src;
    img.hidden = false;
    emptyHint.hidden = true;
    state.lastRenderedKey = key;
    state.previewBusy = false;
    if (state.pendingPreviewSec !== null) {
      const next = state.pendingPreviewSec;
      state.pendingPreviewSec = null;
      if (Math.abs(next - tSec) > 0.01) {
        requestEngineFrame(false);
      }
    }
  };
  preloader.onerror = () => {
    state.previewBusy = false;
  };
  preloader.src = url;
}

function updateStageGizmo() {
  const overlay = $("stageOverlay");
  const gizmo = $("stageGizmo");
  const pill = $("stageGizmoPill");
  const stage = $("monitorStage");
  if (!overlay || !gizmo || !stage) return;

  const clip = getSelectedClip();
  if (!clip || clip.kind === "audio" || clip.kind === "layer") {
    overlay.hidden = true;
    return;
  }

  overlay.hidden = false;
  const scale = Number(clip.scale ?? 1);
  const ox = Number(clip.offsetX ?? 0);
  const oy = Number(clip.offsetY ?? 0);
  const rot = Number(clip.rotation ?? 0);

  const sw = stage.clientWidth || 640;
  const sh = stage.clientHeight || 360;

  const boxW = Math.max(48, sw * (clip.kind === "text" || clip.kind === "shape" ? 0.45 : 0.85) * scale);
  const boxH = Math.max(36, sh * (clip.kind === "text" || clip.kind === "shape" ? 0.22 : 0.85) * scale);
  const cx = sw * (0.5 + ox);
  const cy = sh * (0.5 + oy);

  gizmo.style.width = `${boxW}px`;
  gizmo.style.height = `${boxH}px`;
  gizmo.style.left = `${cx - boxW / 2}px`;
  gizmo.style.top = `${cy - boxH / 2}px`;
  gizmo.style.transform = `rotate(${rot}deg)`;
  pill.textContent = `${Math.round(scale * 100)}% · ${Math.round(rot)}°`;
}

// ─── 3. Context-Aware Inspector Pane ─────────────────────────────────────────
function renderInspectorPane() {
  const tabsEl = $("inspectorTabs");
  const bodyEl = $("inspectorBody");
  const clip = getSelectedClip();

  if (!clip) {
    tabsEl.innerHTML = `<button type="button" class="insp-tab active">โปรเจกต์ & ไทม์ไลน์</button>`;
    const tl = getActiveTimeline();
    const videoCfg = tl?.video || state.view?.settings || { width: 1920, height: 1080 };
    const bg = tl?.background || { kind: "none" };
    bodyEl.innerHTML = `
      <div class="insp-section">
        <div class="insp-section-header">ตั้งค่าไทม์ไลน์ (Timeline Settings)</div>
        <div class="insp-row">
          <span class="insp-label">ชื่อไทม์ไลน์</span>
          <input type="text" id="inspTlName" class="insp-input" value="${escapeHtml(tl?.name || "Timeline 1")}" />
        </div>
        <div class="insp-row">
          <span class="insp-label">ความละเอียด</span>
          <span class="insp-val">${videoCfg.width} × ${videoCfg.height} (${getFps()} fps)</span>
        </div>
        <div class="insp-row">
          <span class="insp-label">พื้นหลังเฟรม</span>
          <select id="inspTlBgKind" class="insp-select">
            <option value="none" ${bg.kind === "none" || !bg.kind ? "selected" : ""}>สีดำมาตรฐาน (Black)</option>
            <option value="blur" ${bg.kind === "blur" ? "selected" : ""}>เบลอภาพด้านหลัง (Blurred Frame)</option>
            <option value="color" ${bg.kind === "color" ? "selected" : ""}>สีทึบกำหนดเอง (Solid Color)</option>
          </select>
        </div>
        <div class="insp-row">
          <span class="insp-label">สีพื้นหลัง</span>
          <input type="color" id="inspTlBgColor" value="${escapeHtml((bg.color || "#151517").slice(0, 7))}" />
        </div>
      </div>
      <div class="insp-section">
        <div class="insp-section-header">คำแนะนำการตัดต่อ</div>
        <div style="font-size:11.5px;color:var(--fg-muted);line-height:1.5">
          • คลิกที่คลิปบนไทม์ไลน์เพื่อปรับขนาด ตำแหน่ง สี เอฟเฟกต์ ความเร็ว คีย์เฟรม หรือตัดพื้นหลัง<br/>
          • ลากกรอบสีเขียวบนหน้าจอ Preview เพื่อย้าย/ย่อขยาย/หมุนคลิปโดยตรง<br/>
          • กด <strong>Space</strong> เพื่อเล่น/หยุด และกด <strong>S</strong> เพื่อหั่นคลิปตรงเส้น Playhead
        </div>
      </div>
    `;

    $("inspTlName")?.addEventListener("change", (e) => {
      if (tl) {
        dispatchCommand({ op: "renameTimeline", timelineId: tl.id, name: e.target.value });
      }
    });
    const updateBg = () => {
      if (!tl) return;
      const kind = $("inspTlBgKind").value;
      const color = $("inspTlBgColor").value;
      const background =
        kind === "blur"
          ? { kind: "blur", amount: 0.5 }
          : kind === "color"
            ? { kind: "color", color }
            : { kind: "none" };
      dispatchCommand({
        op: "setTimelineBackground",
        timelineId: tl.id,
        background,
      });
    };
    $("inspTlBgColor")?.addEventListener("change", updateBg);
    $("inspTlBgKind")?.addEventListener("change", updateBg);
    return;
  }

  // Build tabs based on clip kind
  const tabs = [{ id: "transform", label: "ตำแหน่ง" }];
  if (clip.kind === "text") tabs.push({ id: "text", label: "ข้อความ" });
  if (clip.kind === "shape") tabs.push({ id: "shape", label: "รูปทรง" });
  if (clip.kind !== "audio") {
    tabs.push({ id: "effects", label: "เอฟเฟกต์/สี" });
    tabs.push({ id: "cutout", label: "มาสก์/ไดคัท" });
  }
  if (clip.kind === "video" || clip.kind === "audio") {
    tabs.push({ id: "speed", label: "ความเร็ว/เสียง" });
  }
  tabs.push({ id: "keyframes", label: "คีย์เฟรม" });

  if (!tabs.some((t) => t.id === state.inspectorTab)) {
    state.inspectorTab = clip.kind === "text" ? "text" : clip.kind === "shape" ? "shape" : "transform";
  }

  tabsEl.innerHTML = tabs
    .map(
      (t) =>
        `<button type="button" class="insp-tab ${t.id === state.inspectorTab ? "active" : ""}" data-insp-tab="${t.id}">${t.label}</button>`,
    )
    .join("");

  tabsEl.querySelectorAll("[data-insp-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.inspectorTab = btn.dataset.inspTab;
      renderInspectorPane();
    });
  });

  if (state.inspectorTab === "transform") {
    bodyEl.innerHTML = `
      <div class="insp-section">
        <div class="insp-section-header">
          <span>ขนาดและตำแหน่ง (Transform)</span>
          <button type="button" class="btn" id="btnResetTransform" style="padding:2px 6px;font-size:10px">รีเซ็ต</button>
        </div>
        ${sliderRow("tfScale", "Scale (ขนาด)", Math.round((clip.scale ?? 1) * 100), 10, 300, 1, "%")}
        ${sliderRow("tfOffsetX", "ตำแหน่ง X", Math.round((clip.offsetX ?? 0) * 100), -100, 100, 1, "%")}
        ${sliderRow("tfOffsetY", "ตำแหน่ง Y", Math.round((clip.offsetY ?? 0) * 100), -100, 100, 1, "%")}
        ${sliderRow("tfRot", "หมุนภาพ (Rotate)", Math.round(clip.rotation ?? 0), -180, 180, 1, "°")}
        <div style="display:flex;gap:6px;margin-top:4px">
          <button type="button" class="btn" data-frame-preset="fit" style="flex:1;justify-content:center">Fit พอดีกรอบ</button>
          <button type="button" class="btn" data-frame-preset="fill" style="flex:1;justify-content:center">Fill เต็มกรอบ</button>
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-section-header">ความโปร่งใส & การผสาน (Compositing)</div>
        ${sliderRow("clipOpacity", "Opacity", Math.round((clip.opacity ?? 1) * 100), 0, 100, 1, "%")}
        <div class="insp-row">
          <span class="insp-label">Blend Mode</span>
          <select id="clipBlendMode" class="insp-select">
            ${["normal", "multiply", "screen", "add", "lighten", "darken"]
              .map((m) => `<option value="${m}" ${(clip.blend || "normal") === m ? "selected" : ""}>${m.toUpperCase()}</option>`)
              .join("")}
          </select>
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn ${clip.flipH ? "btn-accent" : ""}" id="btnFlipH" style="flex:1;justify-content:center">↔ กลับซ้าย-ขวา</button>
          <button type="button" class="btn ${clip.flipV ? "btn-accent" : ""}" id="btnFlipV" style="flex:1;justify-content:center">↕ กลับบน-ล่าง</button>
        </div>
      </div>
    `;

    const applyTf = () => {
      dispatchCommand({
        op: "setClipTransform",
        clipId: clip.id,
        scale: Number($("tfScale").value) / 100,
        offsetX: Number($("tfOffsetX").value) / 100,
        offsetY: Number($("tfOffsetY").value) / 100,
        rotation: Number($("tfRot").value),
      });
    };
    bindSlider("tfScale", "%", applyTf);
    bindSlider("tfOffsetX", "%", applyTf);
    bindSlider("tfOffsetY", "%", applyTf);
    bindSlider("tfRot", "°", applyTf);

    $("btnResetTransform")?.addEventListener("click", () => {
      dispatchCommand({
        op: "setClipTransform",
        clipId: clip.id,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
      });
    });

    bodyEl.querySelectorAll("[data-frame-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dispatchCommand({
          op: "frameClip",
          clipId: clip.id,
          framing: btn.getAttribute("data-frame-preset"),
          at: 0,
        });
      });
    });

    bindSlider("clipOpacity", "%", (val) => {
      dispatchCommand({ op: "updateClip", clipId: clip.id, patch: { opacity: val / 100 } });
    });

    $("clipBlendMode")?.addEventListener("change", (e) => {
      dispatchCommand({
        op: "updateClip",
        clipId: clip.id,
        patch: { blend: e.target.value === "normal" ? "" : e.target.value },
      });
    });

    $("btnFlipH")?.addEventListener("click", () => {
      dispatchCommand({ op: "updateClip", clipId: clip.id, patch: { flipH: !clip.flipH } });
    });
    $("btnFlipV")?.addEventListener("click", () => {
      dispatchCommand({ op: "updateClip", clipId: clip.id, patch: { flipV: !clip.flipV } });
    });
    return;
  }

  if (state.inspectorTab === "text") {
    const st = clip.text || {
      content: clip.name || "Your text",
      fontFamily: "Hanken Grotesk",
      fontSize: 0.08,
      fontWeight: 700,
      color: "#ffffff",
      strokeColor: "#000000",
      strokeWidth: 0.008,
      shadow: true,
      background: "",
      align: "center",
    };

    bodyEl.innerHTML = `
      <div class="insp-section">
        <div class="insp-section-header">แก้ไขข้อความ (Text Title)</div>
        <textarea id="inspTextContent" class="insp-textarea" rows="3">${escapeHtml(st.content || "")}</textarea>
        ${sliderRow("inspFontSize", "ขนาดอักษร", Math.round((st.fontSize || 0.08) * 1000), 20, 250, 2, "‰")}
        <div class="insp-row">
          <span class="insp-label">การจัดวาง (Align)</span>
          <select id="inspTextAlign" class="insp-select">
            ${["left", "center", "right"]
              .map((a) => `<option value="${a}" ${(st.align || "center") === a ? "selected" : ""}>${a.toUpperCase()}</option>`)
              .join("")}
          </select>
        </div>
        <div class="insp-row">
          <span class="insp-label">สีข้อความ</span>
          <input type="color" id="inspTextColor" value="${escapeHtml((st.color || "#ffffff").slice(0, 7))}" />
        </div>
        <div class="insp-row">
          <span class="insp-label">สีขอบ (Stroke)</span>
          <input type="color" id="inspStrokeColor" value="${escapeHtml((st.strokeColor || "#000000").slice(0, 7))}" />
        </div>
        ${sliderRow("inspStrokeWidth", "ความหนาขอบ", Math.round((st.strokeWidth || 0) * 1000), 0, 40, 1, "‰")}
        <div class="insp-row">
          <span class="insp-label">เงาข้อความ (Shadow)</span>
          <input type="checkbox" id="inspTextShadow" ${st.shadow !== false ? "checked" : ""} />
        </div>
      </div>
    `;

    const commitTextStyle = () => {
      const nextStyle = {
        ...st,
        content: $("inspTextContent").value,
        fontSize: Number($("inspFontSize").value) / 1000,
        align: $("inspTextAlign").value,
        color: $("inspTextColor").value,
        strokeColor: $("inspStrokeColor").value,
        strokeWidth: Number($("inspStrokeWidth").value) / 1000,
        shadow: $("inspTextShadow").checked,
      };
      dispatchCommand({ op: "updateClip", clipId: clip.id, patch: { text: nextStyle } });
    };

    $("inspTextContent")?.addEventListener("change", commitTextStyle);
    bindSlider("inspFontSize", "‰", commitTextStyle);
    $("inspTextAlign")?.addEventListener("change", commitTextStyle);
    $("inspTextColor")?.addEventListener("change", commitTextStyle);
    $("inspStrokeColor")?.addEventListener("change", commitTextStyle);
    bindSlider("inspStrokeWidth", "‰", commitTextStyle);
    $("inspTextShadow")?.addEventListener("change", commitTextStyle);
    return;
  }

  if (state.inspectorTab === "shape") {
    const sh = clip.shape || {
      kind: "square",
      size: 0.35,
      fill: "#cbf53f",
      stroke: "#ffffff",
      strokeWidth: 0.01,
    };

    bodyEl.innerHTML = `
      <div class="insp-section">
        <div class="insp-section-header">คุณสมบัติรูปทรง (Vector Shape)</div>
        <div class="insp-row">
          <span class="insp-label">รูปทรง</span>
          <select id="inspShapeKind" class="insp-select">
            ${["square", "circle", "triangle", "parallelogram", "trapezoid", "line", "arrow"]
              .map((s) => `<option value="${s}" ${(sh.kind || "square") === s ? "selected" : ""}>${s.toUpperCase()}</option>`)
              .join("")}
          </select>
        </div>
        ${sliderRow("inspShapeSize", "ขนาดรูปทรง", Math.round((sh.size ?? 0.35) * 100), 5, 150, 1, "%")}
        <div class="insp-row">
          <span class="insp-label">สีพื้น (Fill)</span>
          <input type="color" id="inspShapeFill" value="${escapeHtml((sh.fill || "#cbf53f").slice(0, 7))}" />
        </div>
        <div class="insp-row">
          <span class="insp-label">สีเส้นขอบ</span>
          <input type="color" id="inspShapeStroke" value="${escapeHtml((sh.stroke || "#ffffff").slice(0, 7))}" />
        </div>
        ${sliderRow("inspShapeStrokeW", "ความหนาขอบ", Math.round((sh.strokeWidth ?? 0.01) * 1000), 0, 80, 1, "‰")}
      </div>
    `;

    // Note: shape clip properties can be replaced by re-adding or updating transform/opacity
    const updateShapeClip = async () => {
      const nextStyle = {
        kind: $("inspShapeKind").value,
        size: Number($("inspShapeSize").value) / 100,
        fill: $("inspShapeFill").value,
        stroke: $("inspShapeStroke").value,
        strokeWidth: Number($("inspShapeStrokeW").value) / 1000,
      };
      await dispatchCommand({
        op: "batch",
        commands: [
          { op: "removeClips", clipIds: [clip.id], ripple: false },
          {
            op: "addShapeClip",
            trackId: clip.trackId,
            start: clip.start,
            duration: clip.duration,
            name: clip.name || nextStyle.kind,
            style: nextStyle,
          },
        ],
      });
    };

    $("inspShapeKind")?.addEventListener("change", updateShapeClip);
    bindSlider("inspShapeSize", "%", updateShapeClip);
    $("inspShapeFill")?.addEventListener("change", updateShapeClip);
    $("inspShapeStroke")?.addEventListener("change", updateShapeClip);
    bindSlider("inspShapeStrokeW", "‰", updateShapeClip);
    return;
  }

  if (state.inspectorTab === "effects") {
    const activeVfx = clip.videoEffects || [];
    const trIn = clip.transitionIn || null;

    const allVisualPackages = [...(state.catalog.effects || []), ...(state.catalog.filters || [])];
    const pkgOptions = [
      `<option value="">+ เลือกเพิ่มเอฟเฟกต์หรือโทนสี...</option>`,
      ...allVisualPackages.map(
        (p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.kind)})</option>`,
      ),
    ].join("");

    const trOptions = [
      `<option value="none">— ไม่มีทรานซิชัน —</option>`,
      ...(state.catalog.transitions || []).map(
        (t) =>
          `<option value="${escapeHtml(t.id)}" ${trIn?.id === t.id ? "selected" : ""}>${escapeHtml(t.name)}</option>`,
      ),
    ].join("");

    bodyEl.innerHTML = `
      <div class="insp-section">
        <div class="insp-section-header">เอฟเฟกต์ภาพ & โทนสี (${activeVfx.length})</div>
        <select id="inspAddVfxSelect" class="insp-select">${pkgOptions}</select>
        ${
          activeVfx.length === 0
            ? `<div style="font-size:11px;color:var(--fg-dim);margin-top:4px">ยังไม่มีเอฟเฟกต์ในคลิปนี้ เลือกจากรายการด้านบนหรือคลิกจากแผง Library ด้านซ้าย</div>`
            : activeVfx
                .map(
                  (fx, idx) => `
                <div class="insp-row" style="background:var(--well);padding:6px 8px;border-radius:6px;margin-top:4px">
                  <span style="font-size:11.5px;font-weight:600;color:var(--accent)">✨ ${escapeHtml(fx.id)}</span>
                  <button type="button" class="btn-icon" data-remove-vfx="${idx}" title="ลบเอฟเฟกต์">✕</button>
                </div>
              `,
                )
                .join("")
        }
      </div>

      <div class="insp-section">
        <div class="insp-section-header">Transition เข้าสู่คลิป (Transition In)</div>
        <div class="insp-row">
          <span class="insp-label">รูปแบบ</span>
          <select id="inspTransKind" class="insp-select">${trOptions}</select>
        </div>
        ${sliderRow("inspTransDur", "ระยะเวลา", Math.round((trIn?.duration ?? 0.5) * 10), 1, 25, 1, "00ms")}
      </div>
    `;

    $("inspAddVfxSelect")?.addEventListener("change", (e) => {
      const id = e.target.value;
      if (!id) return;
      const next = [...activeVfx, { id, enabled: true, params: {} }];
      dispatchCommand(
        { op: "updateClip", clipId: clip.id, patch: { videoEffects: next } },
        `เพิ่มเอฟเฟกต์ ${id} แล้ว`,
      );
    });

    bodyEl.querySelectorAll("[data-remove-vfx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-remove-vfx"));
        const next = activeVfx.filter((_, i) => i !== idx);
        dispatchCommand({ op: "updateClip", clipId: clip.id, patch: { videoEffects: next } });
      });
    });

    const applyTrans = () => {
      const id = $("inspTransKind").value;
      const duration = Number($("inspTransDur").value) / 10;
      dispatchCommand({
        op: "updateClip",
        clipId: clip.id,
        patch: {
          transitionIn: id === "none" ? null : { id, duration, params: {} },
        },
      });
    };
    $("inspTransKind")?.addEventListener("change", applyTrans);
    bindSlider("inspTransDur", "00ms", applyTrans);
    return;
  }

  if (state.inspectorTab === "cutout") {
    const cutout = clip.cutout || null;
    const mask = clip.mask || null;
    const crop = clip.crop || { left: 0, top: 0, right: 0, bottom: 0 };

    bodyEl.innerHTML = `
      <div class="insp-section">
        <div class="insp-section-header">AI Subject Cutout (ไดคัทตัดพื้นหลัง)</div>
        <div class="insp-row">
          <span class="insp-label">เปิดใช้งาน AI Cutout</span>
          <input type="checkbox" id="chkCutout" ${cutout ? "checked" : ""} />
        </div>
        ${sliderRow("cutoutFeather", "ขอบนุ่ม (Feather)", Math.round((cutout?.feather ?? 0.01) * 1000), 0, 100, 1, "‰")}
      </div>

      <div class="insp-section">
        <div class="insp-section-header">Shape Mask (มาสก์ตัดรูปทรง)</div>
        <div class="insp-row">
          <span class="insp-label">รูปทรงมาสก์</span>
          <select id="inspMaskShape" class="insp-select">
            <option value="none" ${!mask ? "selected" : ""}>— ไม่ใช้มาสก์ —</option>
            ${["circle", "rectangle", "heart", "star", "linear", "mirror"]
              .map((m) => `<option value="${m}" ${mask?.shape === m ? "selected" : ""}>${m.toUpperCase()}</option>`)
              .join("")}
          </select>
        </div>
        ${sliderRow("inspMaskFeather", "ขอบฟุ้ง (Feather)", Math.round((mask?.feather ?? 0.1) * 100), 0, 100, 1, "%")}
      </div>

      <div class="insp-section">
        <div class="insp-section-header">Crop (ครอปตัดขอบภาพ)</div>
        ${sliderRow("cropLeft", "ซ้าย (Left)", Math.round((crop.left || 0) * 100), 0, 45, 1, "%")}
        ${sliderRow("cropRight", "ขวา (Right)", Math.round((crop.right || 0) * 100), 0, 45, 1, "%")}
        ${sliderRow("cropTop", "บน (Top)", Math.round((crop.top || 0) * 100), 0, 45, 1, "%")}
        ${sliderRow("cropBottom", "ล่าง (Bottom)", Math.round((crop.bottom || 0) * 100), 0, 45, 1, "%")}
      </div>

      <div class="insp-section">
        <div class="insp-section-header">กันสั่นวิดีโอ (Stabilization)</div>
        <div class="insp-row">
          <span class="insp-label">เปิดกันสั่น</span>
          <input type="checkbox" id="chkStabilize" ${clip.stabilize ? "checked" : ""} />
        </div>
      </div>
    `;

    const applyCutout = () => {
      const on = $("chkCutout").checked;
      dispatchCommand({
        op: "setClipCutout",
        clipId: clip.id,
        cutout: on
          ? {
              mode: "auto",
              subject: "auto",
              feather: Number($("cutoutFeather").value) / 1000,
              strokes: [],
            }
          : null,
      });
    };
    $("chkCutout")?.addEventListener("change", applyCutout);
    bindSlider("cutoutFeather", "‰", applyCutout);

    const applyMask = () => {
      const shape = $("inspMaskShape").value;
      dispatchCommand({
        op: "updateClip",
        clipId: clip.id,
        patch: {
          mask:
            shape === "none"
              ? null
              : {
                  shape,
                  x: 0,
                  y: 0,
                  width: 0.66,
                  height: 0.66,
                  rotation: 0,
                  roundness: 0,
                  feather: Number($("inspMaskFeather").value) / 100,
                  invert: false,
                },
        },
      });
    };
    $("inspMaskShape")?.addEventListener("change", applyMask);
    bindSlider("inspMaskFeather", "%", applyMask);

    const applyCrop = () => {
      const left = Number($("cropLeft").value) / 100;
      const right = Number($("cropRight").value) / 100;
      const top = Number($("cropTop").value) / 100;
      const bottom = Number($("cropBottom").value) / 100;
      const isNone = left === 0 && right === 0 && top === 0 && bottom === 0;
      dispatchCommand({
        op: "updateClip",
        clipId: clip.id,
        patch: { crop: isNone ? null : { left, right, top, bottom } },
      });
    };
    bindSlider("cropLeft", "%", applyCrop);
    bindSlider("cropRight", "%", applyCrop);
    bindSlider("cropTop", "%", applyCrop);
    bindSlider("cropBottom", "%", applyCrop);

    $("chkStabilize")?.addEventListener("change", (e) => {
      dispatchCommand({
        op: "setClipStabilize",
        clipId: clip.id,
        stabilize: e.target.checked ? { smoothness: 0.5, maxZoom: 1.2, tripod: false } : null,
      });
    });
    return;
  }

  if (state.inspectorTab === "speed") {
    const activeAudioFx = clip.filters || [];
    const audioFxOptions = [
      `<option value="">+ เลือกเพิ่มเอฟเฟกต์เสียง...</option>`,
      ...(state.catalog.audio || []).map(
        (a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`,
      ),
    ].join("");

    bodyEl.innerHTML = `
      <div class="insp-section">
        <div class="insp-section-header">ความเร็วการเล่น (Speed)</div>
        ${sliderRow("inspSpeed", "Speed", Math.round((clip.speed ?? 1) * 100), 25, 400, 5, "%")}
        <div class="insp-row">
          <span class="insp-label">รักษาโทนเสียง (Preserve Pitch)</span>
          <input type="checkbox" id="chkPitch" ${clip.preservePitch !== false ? "checked" : ""} />
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-section-header">ระดับเสียง & Audio DSP</div>
        ${sliderRow("inspVolume", "Volume (ความดัง)", Math.round((clip.volume ?? 1) * 100), 0, 200, 1, "%")}
        ${sliderRow("inspFadeIn", "Fade In", Math.round((clip.fadeIn ?? 0) * 10), 0, 30, 1, "00ms")}
        ${sliderRow("inspFadeOut", "Fade Out", Math.round((clip.fadeOut ?? 0) * 10), 0, 30, 1, "00ms")}
        <select id="inspAudioFx" class="insp-select" style="margin-top:4px">${audioFxOptions}</select>
        ${activeAudioFx
          .map(
            (fx, idx) => `
            <div class="insp-row" style="background:var(--well);padding:4px 8px;border-radius:5px;margin-top:4px">
              <span style="font-size:11px;color:var(--accent)">🔊 ${escapeHtml(fx.id)}</span>
              <button type="button" class="btn-icon" data-remove-afx="${idx}">✕</button>
            </div>
          `,
          )
          .join("")}
        ${
          clip.kind === "video"
            ? `<button type="button" class="btn" id="btnDetachAudio" style="width:100%;justify-content:center;margin-top:6px">🔊 แยกเสียงออกจากวิดีโอ (Detach Audio)</button>`
            : ""
        }
      </div>
    `;

    bindSlider("inspSpeed", "%", (v) =>
      dispatchCommand({
        op: "setClipSpeed",
        clipId: clip.id,
        speed: v / 100,
        ripple: state.rippleEnabled,
      }),
    );
    $("chkPitch")?.addEventListener("change", (e) => {
      dispatchCommand({ op: "updateClip", clipId: clip.id, patch: { preservePitch: e.target.checked } });
    });
    bindSlider("inspVolume", "%", (v) =>
      dispatchCommand({ op: "updateClip", clipId: clip.id, patch: { volume: v / 100 } }),
    );
    bindSlider("inspFadeIn", "00ms", (v) =>
      dispatchCommand({ op: "updateClip", clipId: clip.id, patch: { fadeIn: v / 10 } }),
    );
    bindSlider("inspFadeOut", "00ms", (v) =>
      dispatchCommand({ op: "updateClip", clipId: clip.id, patch: { fadeOut: v / 10 } }),
    );
    $("inspAudioFx")?.addEventListener("change", (e) => {
      const id = e.target.value;
      if (!id) return;
      const next = [...activeAudioFx, { id, enabled: true, params: {} }];
      dispatchCommand(
        { op: "updateClip", clipId: clip.id, patch: { filters: next } },
        `เพิ่มเอฟเฟกต์เสียง ${id} แล้ว`,
      );
    });
    bodyEl.querySelectorAll("[data-remove-afx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-remove-afx"));
        const next = activeAudioFx.filter((_, i) => i !== idx);
        dispatchCommand({ op: "updateClip", clipId: clip.id, patch: { filters: next } });
      });
    });
    $("btnDetachAudio")?.addEventListener("click", () => {
      dispatchCommand({ op: "detachAudio", clipId: clip.id }, "แยกแทร็กเสียงออกมาแล้ว");
    });
    return;
  }

  if (state.inspectorTab === "keyframes") {
    const dur = Math.max(0.1, Number(clip.duration) || 1);
    const atFraction = Math.max(0, Math.min(1, (state.playheadSec - (Number(clip.start) || 0)) / dur));
    const keysList = clip.keys || [];

    bodyEl.innerHTML = `
      <div class="insp-section">
        <div class="insp-section-header">เพิ่มคีย์เฟรม ณ ตำแหน่ง ${(atFraction * 100).toFixed(0)}% ของคลิป</div>
        <div class="insp-row">
          <span class="insp-label">คุณสมบัติ</span>
          <select id="kfPropSelect" class="insp-select">
            <option value="scale">Scale (ขนาด)</option>
            <option value="offsetX">Offset X (แนวนอน)</option>
            <option value="offsetY">Offset Y (แนวตั้ง)</option>
            <option value="rotation">Rotation (หมุน)</option>
            <option value="opacity">Opacity (ความทึบ)</option>
            <option value="volume">Volume (ความดัง)</option>
          </select>
        </div>
        <button type="button" class="btn btn-accent" id="btnAddKeyframe" style="width:100%;justify-content:center">
          ◆ ปักคีย์เฟรมที่จุด Playhead ปัจจุบัน
        </button>
      </div>

      <div class="insp-section">
        <div class="insp-section-header">รายการคีย์เฟรมในคลิปนี้ (${keysList.length})</div>
        ${
          keysList.length === 0
            ? `<div style="font-size:11px;color:var(--fg-dim)">ยังไม่มีคีย์เฟรม เลื่อน Playhead แล้วกดปุ่มปักคีย์เฟรมด้านบน</div>`
            : keysList
                .map(
                  (pt) => `
                  <div class="insp-row" style="background:var(--well);padding:4px 8px;border-radius:5px">
                    <span style="font-size:11px;color:var(--accent)">◆ ${escapeHtml(pt.property)} @ ${Math.round(Number(pt.at) * 100)}% = ${Number(pt.value).toFixed(2)}</span>
                    <button type="button" class="btn-icon" data-del-kf-prop="${escapeHtml(pt.property)}" data-del-kf-at="${pt.at}">✕</button>
                  </div>
                `,
                )
                .join("")
        }
      </div>
    `;

    $("btnAddKeyframe")?.addEventListener("click", () => {
      const prop = $("kfPropSelect").value;
      const currentValMap = {
        scale: clip.scale ?? 1,
        offsetX: clip.offsetX ?? 0,
        offsetY: clip.offsetY ?? 0,
        rotation: clip.rotation ?? 0,
        opacity: clip.opacity ?? 1,
        volume: clip.volume ?? 1,
      };
      dispatchCommand(
        {
          op: "setClipKey",
          clipId: clip.id,
          property: prop,
          at: Number(atFraction.toFixed(4)),
          value: Number(currentValMap[prop] ?? 1),
          ease: [0.42, 0.0, 0.58, 1.0],
        },
        `ปักคีย์เฟรม ${prop} ที่ ${Math.round(atFraction * 100)}% แล้ว`,
      );
    });

    bodyEl.querySelectorAll("[data-del-kf-prop]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dispatchCommand({
          op: "clearClipKey",
          clipId: clip.id,
          property: btn.getAttribute("data-del-kf-prop"),
          at: Number(btn.getAttribute("data-del-kf-at")),
        });
      });
    });
  }
}

function sliderRow(id, label, val, min, max, step, unit) {
  return `
    <div class="insp-row">
      <label class="insp-label" for="${id}">${escapeHtml(label)}</label>
      <div class="insp-control">
        <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}" />
        <span class="insp-val" id="${id}_val">${val}${unit}</span>
      </div>
    </div>
  `;
}

function bindSlider(id, unit, onCommit) {
  const input = $(id);
  const valEl = $(`${id}_val`);
  if (!input) return;
  input.addEventListener("input", () => {
    if (valEl) valEl.textContent = `${input.value}${unit}`;
  });
  input.addEventListener("change", () => {
    onCommit(Number(input.value));
  });
}

// ─── 4. Multi-Track Timeline Pane ────────────────────────────────────────────
function renderTimelinePane() {
  const proj = getProject();
  if (!proj) return;

  // 1. Timeline Tabs
  const timelines = proj.timelines || [];
  const activeTl = getActiveTimeline();
  const tabsList = $("timelineTabsList");

  tabsList.innerHTML =
    timelines
      .map(
        (t) => `
        <div class="tl-tab ${t.id === activeTl?.id ? "active" : ""}" data-tl-id="${escapeHtml(t.id)}">
          <span>🎞️ ${escapeHtml(t.name)}</span>
        </div>
      `,
      )
      .join("") +
    `<button type="button" class="btn-icon" id="btnNewTimelineTab" title="สร้างไทม์ไลน์ใหม่" style="width:24px;height:22px">＋</button>`;

  tabsList.querySelectorAll("[data-tl-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-tl-id");
      if (id !== activeTl?.id) {
        dispatchCommand({ op: "selectTimeline", timelineId: id });
      }
    });
  });

  $("btnNewTimelineTab")?.addEventListener("click", () => {
    dispatchCommand({ op: "addTimeline" }, "สร้างไทม์ไลน์ใหม่แล้ว");
  });

  const tracks = getTracks();
  const allClips = getAllClips();
  $("timelineSummaryLabel").textContent = `${tracks.length} แทร็ก · ${allClips.length} คลิป`;

  // 2. Track Headers (In Concat, tracks[0] is top track T1, tracks[last] is bottom track)
  const headersList = $("trackHeadersList");

  headersList.innerHTML = tracks
    .map(
      (track, idx) => `
      <div class="track-header-row" data-track-id="${escapeHtml(track.id)}">
        <span class="track-name">${escapeHtml(track.id)} · Lane ${idx + 1}</span>
        <div class="track-btns">
          <button type="button" class="track-mini-btn ${track.visible === false ? "off" : ""}" data-toggle-vis="${escapeHtml(track.id)}" title="ซ่อน/แสดงแทร็ก">
            ${track.visible === false ? "🚫" : "👁"}
          </button>
          <button type="button" class="track-mini-btn ${track.muted ? "off" : ""}" data-toggle-mute="${escapeHtml(track.id)}" title="ปิด/เปิดเสียงแทร็ก">
            ${track.muted ? "🔇" : "🔊"}
          </button>
          ${
            tracks.length > 1
              ? `<button type="button" class="track-mini-btn" data-remove-track="${escapeHtml(track.id)}" title="ลบแทร็ก">✕</button>`
              : ""
          }
        </div>
      </div>
    `,
    )
    .join("");

  headersList.querySelectorAll("[data-toggle-vis]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tid = btn.getAttribute("data-toggle-vis");
      const tr = tracks.find((t) => t.id === tid);
      if (!tr) return;
      dispatchCommand({
        op: "setTrackFlag",
        trackId: tid,
        flag: "visible",
        value: tr.visible === false,
      });
    });
  });

  headersList.querySelectorAll("[data-toggle-mute]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tid = btn.getAttribute("data-toggle-mute");
      const tr = tracks.find((t) => t.id === tid);
      if (!tr) return;
      dispatchCommand({
        op: "setTrackFlag",
        trackId: tid,
        flag: "muted",
        value: !tr.muted,
      });
    });
  });

  headersList.querySelectorAll("[data-remove-track]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tid = btn.getAttribute("data-remove-track");
      dispatchCommand({ op: "removeTrack", trackId: tid }, `ลบแทร็ก ${tid} แล้ว`);
    });
  });

  // 3. Timeline Canvas Width & Time Ruler
  const totalSec = Math.max(getTimelineDuration() + 8, 20);
  const canvasWidth = Math.max(900, Math.round(totalSec * state.pxPerSec));
  const canvasInner = $("timelineCanvasInner");
  canvasInner.style.width = `${canvasWidth}px`;

  renderTimeRuler(totalSec);

  // 4. Lanes & Clips
  const lanesStack = $("lanesStack");
  lanesStack.innerHTML = tracks
    .map((track) => {
      const trackClips = getClipsForTrack(track.id);
      const clipsHtml = trackClips.map((clip) => renderClipBlock(clip)).join("");
      return `<div class="track-lane" data-lane-track-id="${escapeHtml(track.id)}">${clipsHtml}</div>`;
    })
    .join("");

  bindClipInteractions();
  updatePlayheadPosition();

  for (const clip of allClips) {
    if ((clip.kind === "audio" || clip.kind === "video") && clip.mediaId) {
      ensureWaveform(clip.mediaId);
    }
  }
}

function renderTimeRuler(totalSec) {
  const ruler = $("timeRuler");
  const stepSec = state.pxPerSec >= 100 ? 1 : state.pxPerSec >= 45 ? 2 : 5;
  const ticks = [];
  for (let s = 0; s <= totalSec; s += stepSec) {
    const x = Math.round(s * state.pxPerSec);
    ticks.push(
      `<div class="ruler-tick major" style="left:${x}px"><span>${formatShortDuration(s)}</span></div>`,
    );
  }
  ruler.innerHTML = ticks.join("");
}

function renderClipBlock(clip) {
  const leftPx = Math.round((Number(clip.start) || 0) * state.pxPerSec);
  const widthPx = Math.max(24, Math.round((Number(clip.duration) || 1) * state.pxPerSec));
  const isSel = clip.id === state.selectedClipId;
  const media = getMediaById(clip.mediaId);

  let label = clip.name || media?.name || clip.kind.toUpperCase();
  if (clip.kind === "text") label = `T: ${clip.text?.content || clip.name || "Title"}`;
  if (clip.kind === "shape") label = `⬢ ${clip.name || clip.shape?.kind || "Shape"}`;
  if (clip.kind === "layer") label = `✨ ${clip.name || "Adjustment Layer"}`;

  const badges = [];
  if (clip.videoEffects?.length > 0) badges.push(`FX×${clip.videoEffects.length}`);
  if (clip.filters?.length > 0) badges.push(`DSP×${clip.filters.length}`);
  if (clip.transitionIn?.id) badges.push(`⇄ ${clip.transitionIn.id}`);
  if (clip.speed && Math.abs(clip.speed - 1) > 0.01) badges.push(`${clip.speed.toFixed(1)}x`);
  if (clip.keys?.length > 0) badges.push(`◆${clip.keys.length}`);

  let waveformHtml = "";
  if (clip.mediaId && state.waveforms.has(clip.mediaId)) {
    const peaks = state.waveforms.get(clip.mediaId) || [];
    const barCount = Math.min(peaks.length, Math.max(8, Math.floor(widthPx / 5)));
    const bars = [];
    for (let i = 0; i < barCount; i++) {
      const p = peaks[Math.floor((i / barCount) * peaks.length)] || 0.15;
      bars.push(`<div class="waveform-bar" style="height:${Math.round(p * 100)}%"></div>`);
    }
    waveformHtml = `<div class="clip-waveform">${bars.join("")}</div>`;
  }

  return `
    <div class="tl-clip clip-${escapeHtml(clip.kind)} ${isSel ? "selected" : ""}"
         data-clip-id="${escapeHtml(clip.id)}"
         data-track-id="${escapeHtml(clip.trackId)}"
         style="left:${leftPx}px;width:${widthPx}px">
      <div class="trim-handle left" data-trim="start" title="ลากเพื่อตัดช่วงต้นคลิป"></div>
      <div class="clip-header">
        <span class="clip-title">${escapeHtml(label)}</span>
        ${badges.map((b) => `<span class="clip-badge">${escapeHtml(b)}</span>`).join("")}
      </div>
      ${waveformHtml}
      <div class="trim-handle right" data-trim="end" title="ลากเพื่อตัดช่วงท้ายคลิป"></div>
    </div>
  `;
}

async function ensureWaveform(mediaId) {
  if (state.waveforms.has(mediaId)) return;
  const media = getMediaById(mediaId);
  if (!media || !media.path) return;
  state.waveforms.set(mediaId, [0.2, 0.35, 0.25, 0.45]);
  try {
    const res = await api(`/api/media-waveform?file=${encodeURIComponent(media.path)}&bars=64`);
    const arr = res.peaks || res.bars;
    if (Array.isArray(arr)) {
      state.waveforms.set(mediaId, arr);
      renderTimelinePane();
    }
  } catch {
    // ignore
  }
}

// ─── Pointer-Captured Timeline & Gizmo Dragging (modern-web-guidance) ────────
function bindClipInteractions() {
  const lanesStack = $("lanesStack");
  if (!lanesStack) return;

  lanesStack.querySelectorAll(".tl-clip").forEach((clipEl) => {
    clipEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      const clipId = clipEl.getAttribute("data-clip-id");
      const clip = getAllClips().find((c) => c.id === clipId);
      if (!clip) return;

      if (state.selectedClipId !== clipId) {
        state.selectedClipId = clipId;
        renderStudio();
        return;
      }

      const trimSide = e.target.closest("[data-trim]")?.getAttribute("data-trim");
      const startX = e.clientX;
      const startY = e.clientY;
      const origStart = Number(clip.start) || 0;
      const origDuration = Number(clip.duration) || 1;
      const origTrackId = clip.trackId;

      clipEl.setPointerCapture(e.pointerId);
      clipEl.classList.add("is-dragging");

      let currentNewStart = origStart;
      let currentDelta = 0;
      let currentNewTrackId = origTrackId;
      let moved = false;

      const onMove = (me) => {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
        const dt = dx / state.pxPerSec;

        if (trimSide === "start") {
          currentDelta = Math.max(-origStart, Math.min(origDuration - 0.1, dt));
          const previewStart = origStart + currentDelta;
          const previewDur = origDuration - currentDelta;
          clipEl.style.left = `${Math.round(previewStart * state.pxPerSec)}px`;
          clipEl.style.width = `${Math.max(20, Math.round(previewDur * state.pxPerSec))}px`;
        } else if (trimSide === "end") {
          currentDelta = Math.max(-(origDuration - 0.1), dt);
          const previewDur = origDuration + currentDelta;
          clipEl.style.width = `${Math.max(20, Math.round(previewDur * state.pxPerSec))}px`;
        } else {
          let nextStart = Math.max(0, origStart + dt);
          if (state.snapEnabled) {
            nextStart = snapTime(nextStart, clip.id, origDuration);
          }
          currentNewStart = nextStart;
          clipEl.style.left = `${Math.round(currentNewStart * state.pxPerSec)}px`;

          const laneEl = document
            .elementFromPoint(me.clientX, me.clientY)
            ?.closest("[data-lane-track-id]");
          if (laneEl) {
            currentNewTrackId = laneEl.getAttribute("data-lane-track-id");
          }
        }
      };

      const onEnd = async () => {
        clipEl.classList.remove("is-dragging");
        clipEl.removeEventListener("pointermove", onMove);
        clipEl.removeEventListener("pointerup", onEnd);
        clipEl.removeEventListener("pointercancel", onEnd);

        if (!moved) return;

        if (trimSide === "start" || trimSide === "end") {
          await dispatchCommand({
            op: "trimClip",
            clipId: clip.id,
            edge: trimSide,
            delta: Number(currentDelta.toFixed(4)),
            ripple: state.rippleEnabled,
          });
        } else {
          await dispatchCommand({
            op: "moveClips",
            moves: [
              {
                clipId: clip.id,
                trackId: currentNewTrackId,
                start: Number(currentNewStart.toFixed(4)),
              },
            ],
          });
        }
      };

      clipEl.addEventListener("pointermove", onMove);
      clipEl.addEventListener("pointerup", onEnd);
      clipEl.addEventListener("pointercancel", onEnd);
    });
  });
}

function snapTime(candidateSec, ignoreClipId, duration) {
  const threshSec = 8 / state.pxPerSec;
  const targets = [0, state.playheadSec];
  for (const c of getAllClips()) {
    if (c.id === ignoreClipId) continue;
    targets.push(Number(c.start) || 0);
    targets.push((Number(c.start) || 0) + (Number(c.duration) || 0));
  }
  for (const t of targets) {
    if (Math.abs(candidateSec - t) < threshSec) return t;
    if (Math.abs(candidateSec + duration - t) < threshSec) return Math.max(0, t - duration);
  }
  return candidateSec;
}

// ─── Playback Clock & Timecode ───────────────────────────────────────────────
function updateTimecodeDisplay() {
  const fps = getFps();
  $("timecodeCurrent").textContent = formatTimecode(state.playheadSec, fps);
  $("timecodeTotal").textContent = `/ ${formatTimecode(getTimelineDuration(), fps)}`;
  $("btnPlayToggle").textContent = state.isPlaying ? "⏸" : "▶";
}

function updatePlayheadPosition() {
  const line = $("playheadLine");
  if (!line) return;
  const x = Math.round(state.playheadSec * state.pxPerSec);
  line.style.left = `${x}px`;
}

function setPlayhead(sec, triggerRender = true) {
  const maxDur = getTimelineDuration();
  state.playheadSec = Math.max(0, Math.min(maxDur, Number(sec) || 0));
  updateTimecodeDisplay();
  updatePlayheadPosition();
  if (triggerRender) {
    requestEngineFrame(false);
  }
}

let lastFrameTs = 0;
function togglePlay() {
  state.isPlaying = !state.isPlaying;
  if (state.isPlaying) {
    if (state.playheadSec >= getTimelineDuration() - 0.05) {
      state.playheadSec = 0;
    }
    syncTimelineAudio(true);
    lastFrameTs = performance.now();
    requestAnimationFrame(playbackTick);
  } else {
    syncTimelineAudio(false);
  }
  updateTimecodeDisplay();
}

function playbackTick(now) {
  if (!state.isPlaying) return;
  const dt = (now - lastFrameTs) / 1000;
  lastFrameTs = now;

  const nextSec = state.playheadSec + dt;
  const total = getTimelineDuration();
  if (nextSec >= total) {
    state.playheadSec = total;
    state.isPlaying = false;
    syncTimelineAudio(false);
    updateTimecodeDisplay();
    updatePlayheadPosition();
    requestEngineFrame(true);
    return;
  }

  setPlayhead(nextSec, true);
  requestAnimationFrame(playbackTick);
}

function syncTimelineAudio(play) {
  if (!play) {
    state.audioPreviewEl.pause();
    return;
  }
  const tracks = getTracks();
  const mutedTrackIds = new Set(tracks.filter((t) => t.muted).map((t) => t.id));
  for (const c of getAllClips()) {
    if (mutedTrackIds.has(c.trackId) || c.muted) continue;
    if ((c.kind === "audio" || c.kind === "video") && c.mediaId) {
      const start = Number(c.start) || 0;
      const end = start + (Number(c.duration) || 0);
      if (state.playheadSec >= start && state.playheadSec < end) {
        const media = getMediaById(c.mediaId);
        if (media?.path) {
          const srcUrl = `/api/media-stream?file=${encodeURIComponent(media.path)}`;
          if (!state.audioPreviewEl.src.endsWith(srcUrl)) {
            state.audioPreviewEl.src = srcUrl;
          }
          const sourceTime =
            (Number(c.sourceStart) || 0) + (state.playheadSec - start) * (c.speed || 1);
          state.audioPreviewEl.currentTime = Math.max(0, sourceTime);
          state.audioPreviewEl.volume = Math.min(1, Math.max(0, Number(c.volume ?? 1)));
          state.audioPreviewEl.playbackRate = Math.min(4, Math.max(0.25, Number(c.speed ?? 1)));
          state.audioPreviewEl.play().catch(() => {});
          return;
        }
      }
    }
  }
  state.audioPreviewEl.pause();
}

// ─── Global Event Listeners ──────────────────────────────────────────────────
function bindGlobalEvents() {
  window.addEventListener("resize", () => fitStageAspect());

  $("btnHome")?.addEventListener("click", async () => {
    state.isPlaying = false;
    syncTimelineAudio(false);
    const data = await api("/api/bootstrap");
    state.projects = data.projects || [];
    renderLaunchScreen();
  });

  $("btnThemeToggle")?.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", state.theme);
    $("btnThemeToggle").textContent = state.theme === "dark" ? "🌙" : "☀️";
  });

  document.querySelectorAll("#accentPicker .accent-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      const key = dot.getAttribute("data-accent");
      const token = ACCENT_MAP[key];
      if (!token) return;
      state.accent = key;
      document.documentElement.style.setProperty("--accent", token.accent);
      document.documentElement.style.setProperty("--accent-soft", token.soft);
      document.documentElement.style.setProperty("--accent-border", token.border);
      document.documentElement.style.setProperty("--accent-ink", token.ink);
      document.querySelectorAll("#accentPicker .accent-dot").forEach((d) =>
        d.classList.toggle("active", d === dot),
      );
    });
  });

  $("btnLangToggle")?.addEventListener("click", () => {
    state.lang = state.lang === "th" ? "en" : "th";
    $("btnLangToggle").textContent = state.lang.toUpperCase();
    showToast(state.lang === "th" ? "เปลี่ยนภาษาเป็นภาษาไทย" : "Switched to English");
  });

  const openDemo = async () => {
    try {
      showToast("กำลังเปิดโปรเจกต์ตัวอย่างพร้อมฟุตเทจและเสียง...");
      const res = await api("/api/project/demo", { method: "POST", body: "{}" });
      openProjectIntoStudio(res.path, res.view);
      showToast("เปิดโปรเจกต์ตัวอย่างพร้อมตัดต่อแล้ว!", "success");
    } catch (err) {
      showToast(`สร้างโปรเจกต์ตัวอย่างไม่สำเร็จ: ${err.message}`, "error");
    }
  };
  $("btnLaunchDemo")?.addEventListener("click", openDemo);
  $("btnMenuDemo")?.addEventListener("click", openDemo);

  const showNewProjModal = () => $("dialogNewProject")?.showModal();
  $("btnLaunchCreate")?.addEventListener("click", showNewProjModal);
  $("btnMenuNew")?.addEventListener("click", showNewProjModal);

  $("formNewProject")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("newProjName").value.trim() || "Untitled Project";
    const [w, h] = $("newProjRes").value.split("x").map(Number);
    const fps = Number($("newProjFps").value) || 30;
    try {
      const res = await api("/api/project/create", {
        method: "POST",
        body: JSON.stringify({
          name,
          video: { width: w, height: h, rateNum: fps, rateDen: 1 },
        }),
      });
      $("dialogNewProject").close();
      openProjectIntoStudio(res.path, res.view);
      showToast(`สร้างโปรเจกต์ "${name}" เรียบร้อยแล้ว`, "success");
    } catch (err) {
      showToast(`สร้างโปรเจกต์ไม่สำเร็จ: ${err.message}`, "error");
    }
  });

  $("btnMenuSave")?.addEventListener("click", async () => {
    if (!state.projectPath) return;
    await api("/api/project/save", {
      method: "POST",
      body: JSON.stringify({ path: state.projectPath, name: $("projectNameInput").value }),
    });
    showToast("บันทึกโปรเจกต์เรียบร้อยแล้ว", "success");
  });

  $("projectNameInput")?.addEventListener("change", async (e) => {
    if (!state.projectPath) return;
    const res = await api("/api/project/save", {
      method: "POST",
      body: JSON.stringify({ path: state.projectPath, name: e.target.value }),
    });
    if (res.view) state.view = res.view;
  });

  $("launchSearchInput")?.addEventListener("input", () => renderLaunchScreen());

  document.querySelectorAll("#libraryNav .lib-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.libraryTab = btn.dataset.tab;
      renderLibraryPane();
    });
  });

  document.querySelectorAll("#mediaSidebar .media-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.mediaFilter = btn.dataset.filter;
      renderLibraryPane();
    });
  });

  $("librarySearchInput")?.addEventListener("input", (e) => {
    state.librarySearch = e.target.value;
    renderLibraryPane();
  });

  $("btnImportMedia")?.addEventListener("click", () => $("fileUploadInput")?.click());
  $("fileUploadInput")?.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      await uploadMediaFile(file);
    }
    e.target.value = "";
  });

  const libContent = document.querySelector(".library-content");
  libContent?.addEventListener("dragover", (e) => e.preventDefault());
  libContent?.addEventListener("drop", async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    for (const f of files) {
      await uploadMediaFile(f);
    }
  });

  $("btnPlayToggle")?.addEventListener("click", togglePlay);
  $("btnJumpStart")?.addEventListener("click", () => setPlayhead(0));
  $("btnJumpEnd")?.addEventListener("click", () => setPlayhead(getTimelineDuration()));
  $("btnStepBack")?.addEventListener("click", () => {
    setPlayhead(state.playheadSec - 1 / getFps());
  });
  $("btnStepForward")?.addEventListener("click", () => {
    setPlayhead(state.playheadSec + 1 / getFps());
  });
  $("btnRefreshFrame")?.addEventListener("click", () => requestEngineFrame(true));

  $("aspectRatioSelect")?.addEventListener("change", async (e) => {
    if (!state.projectPath) return;
    const [w, h] = e.target.value.split("x").map(Number);
    const fps = getFps();
    const res = await api("/api/project/video", {
      method: "POST",
      body: JSON.stringify({
        path: state.projectPath,
        video: { width: w, height: h, rateNum: fps, rateDen: 1 },
      }),
    });
    if (res.view) state.view = res.view;
    fitStageAspect();
    renderStudio();
    requestEngineFrame(true);
  });

  $("previewQualitySelect")?.addEventListener("change", (e) => {
    state.previewScale = Number(e.target.value) || 0.5;
    requestEngineFrame(true);
  });

  bindStageGizmoInteractions();

  $("btnAddTrack")?.addEventListener("click", () =>
    dispatchCommand({ op: "addTrack", bottom: false }, "เพิ่มแทร็กใหม่ด้านบนแล้ว"),
  );
  $("btnUndo")?.addEventListener("click", async () => {
    if (!state.projectPath) return;
    const res = await api("/api/undo", {
      method: "POST",
      body: JSON.stringify({ path: state.projectPath }),
    });
    if (res.view) state.view = res.view;
    renderStudio();
    requestEngineFrame(true);
  });
  $("btnRedo")?.addEventListener("click", async () => {
    if (!state.projectPath) return;
    const res = await api("/api/redo", {
      method: "POST",
      body: JSON.stringify({ path: state.projectPath }),
    });
    if (res.view) state.view = res.view;
    renderStudio();
    requestEngineFrame(true);
  });

  $("btnSplit")?.addEventListener("click", () => {
    const sel = getSelectedClip();
    const targetIds = sel ? [sel.id] : getAllClips().map((c) => c.id);
    if (targetIds.length === 0) return;
    dispatchCommand(
      { op: "splitClips", clipIds: targetIds, time: state.playheadSec },
      "หั่นคลิปที่ตำแหน่ง Playhead แล้ว",
    );
  });

  $("btnMerge")?.addEventListener("click", () => {
    const sel = getSelectedClip();
    const targetTrack = sel ? sel.trackId : getTracks()[0]?.id;
    const clips = getAllClips().filter((c) => c.trackId === targetTrack);
    if (clips.length < 2) {
      showToast("ต้องมีคลิปที่ถูกหั่นติดกันอย่างน้อย 2 ชิ้นในแทร็กเดียวกัน", "error");
      return;
    }
    dispatchCommand(
      { op: "mergeClips", clipIds: clips.map((c) => c.id) },
      "รวมคลิปที่ติดกันเรียบร้อยแล้ว",
    );
  });

  $("btnDeleteClip")?.addEventListener("click", () => {
    if (!state.selectedClipId) return;
    const id = state.selectedClipId;
    state.selectedClipId = null;
    dispatchCommand(
      { op: "removeClips", clipIds: [id], ripple: state.rippleEnabled },
      "ลบคลิปแล้ว",
    );
  });

  $("btnSnapToggle")?.addEventListener("click", () => {
    state.snapEnabled = !state.snapEnabled;
    $("btnSnapToggle").classList.toggle("active", state.snapEnabled);
  });

  $("btnMagneticToggle")?.addEventListener("click", () => {
    state.rippleEnabled = !state.rippleEnabled;
    $("btnMagneticToggle").classList.toggle("active", state.rippleEnabled);
    showToast(
      state.rippleEnabled ? "เปิดโหมด Magnetic Ripple Timeline แล้ว" : "ปิดโหมด Magnetic Ripple แล้ว",
    );
  });

  $("btnQuickTitle")?.addEventListener("click", () => {
    dispatchCommand(
      {
        op: "addTextClip",
        trackId: null,
        above: true,
        start: state.playheadSec,
        duration: 3.5,
        offsetY: 0,
        style: {
          content: "พิมพ์ข้อความของคุณ",
          fontFamily: "Thonburi",
          fontSize: 0.08,
          fontWeight: 700,
          color: "#ffffff",
          strokeColor: "#000000",
          strokeWidth: 0.008,
          shadow: true,
          background: "#00000088",
        },
      },
      "เพิ่มข้อความที่ Playhead แล้ว",
    );
  });

  $("zoomSlider")?.addEventListener("input", (e) => {
    state.pxPerSec = Number(e.target.value) || 65;
    renderTimelinePane();
  });
  $("btnZoomIn")?.addEventListener("click", () => {
    state.pxPerSec = Math.min(240, state.pxPerSec + 20);
    $("zoomSlider").value = state.pxPerSec;
    renderTimelinePane();
  });
  $("btnZoomOut")?.addEventListener("click", () => {
    state.pxPerSec = Math.max(15, state.pxPerSec - 20);
    $("zoomSlider").value = state.pxPerSec;
    renderTimelinePane();
  });
  $("btnZoomFit")?.addEventListener("click", () => {
    const scrollW = $("timelineScroll")?.clientWidth || 800;
    const dur = Math.max(10, getTimelineDuration() + 2);
    state.pxPerSec = Math.min(240, Math.max(15, Math.floor((scrollW - 40) / dur)));
    $("zoomSlider").value = state.pxPerSec;
    renderTimelinePane();
  });

  const ruler = $("timeRuler");
  ruler?.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    ruler.setPointerCapture(e.pointerId);
    const updateFromEvent = (ev) => {
      const rect = $("timelineCanvasInner").getBoundingClientRect();
      const x = Math.max(0, ev.clientX - rect.left);
      setPlayhead(x / state.pxPerSec, true);
    };
    updateFromEvent(e);
    const onMove = (me) => updateFromEvent(me);
    const onUp = () => {
      ruler.removeEventListener("pointermove", onMove);
      ruler.removeEventListener("pointerup", onUp);
      requestEngineFrame(true);
    };
    ruler.addEventListener("pointermove", onMove);
    ruler.addEventListener("pointerup", onUp);
  });

  document.querySelectorAll("[data-close-dialog]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-close-dialog");
      $(id)?.close();
    });
  });

  $("btnOpenTts")?.addEventListener("click", () => $("dialogTts")?.showModal());
  $("formTts")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.projectPath) return;
    const text = $("ttsText").value.trim();
    const voice = $("ttsVoice").value;
    if (!text) return;
    try {
      $("btnSubmitTts").disabled = true;
      showToast("กำลังสังเคราะห์เสียงพูด AI และวางลงไทม์ไลน์...");
      const res = await api("/api/tts", {
        method: "POST",
        body: JSON.stringify({
          path: state.projectPath,
          text,
          voice,
          start: state.playheadSec,
          addToTimeline: true,
        }),
      });
      if (res.view) state.view = res.view;
      $("dialogTts").close();
      renderStudio();
      showToast("เพิ่มเสียงพากย์ลงไทม์ไลน์เรียบร้อยแล้ว!", "success");
    } catch (err) {
      showToast(`สร้างเสียงพากย์ไม่สำเร็จ: ${err.message}`, "error");
    } finally {
      $("btnSubmitTts").disabled = false;
    }
  });

  $("btnOpenCaptions")?.addEventListener("click", () => $("dialogCaptions")?.showModal());
  $("formCaptions")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.projectPath) return;
    const raw = $("captionsTextarea").value.trim();
    const color = $("captionsColor").value || "#ffffff";
    if (!raw) return;

    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    let cursor = state.playheadSec;
    const captions = lines.map((line) => {
      const match = line.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*:\s*(.+)$/);
      if (match) {
        const start = Number(match[1]);
        const end = Math.max(start + 0.4, Number(match[2]));
        cursor = end;
        return { start, end, text: match[3] };
      }
      const item = { start: cursor, end: cursor + 2.5, text: line };
      cursor += 2.5;
      return item;
    });

    try {
      const res = await api("/api/captions", {
        method: "POST",
        body: JSON.stringify({
          path: state.projectPath,
          captions,
          style: {
            color,
            fontFamily: "Thonburi",
            fontSize: 0.058,
            fontWeight: 700,
            strokeColor: "#000000",
            strokeWidth: 0.008,
            shadow: true,
            background: "#00000099",
          },
          offsetY: 0.35,
        }),
      });
      if (res.view) state.view = res.view;
      $("dialogCaptions").close();
      renderStudio();
      requestEngineFrame(true);
      showToast(`วางซับไตเติล ${captions.length} บรรทัดลงไทม์ไลน์แล้ว`, "success");
    } catch (err) {
      showToast(`เพิ่มซับไตเติลไม่สำเร็จ: ${err.message}`, "error");
    }
  });

  $("btnOpenExport")?.addEventListener("click", () => {
    $("exportProgressBox").hidden = true;
    $("exportDoneBox").hidden = true;
    $("btnCancelExportJob").hidden = true;
    $("btnStartExport").disabled = false;
    $("dialogExport")?.showModal();
  });

  $("btnStartExport")?.addEventListener("click", startExportJob);
  $("btnCancelExportJob")?.addEventListener("click", async () => {
    if (state.activeExportJobId) {
      await api("/api/export/cancel", {
        method: "POST",
        body: JSON.stringify({ job: state.activeExportJobId }),
      });
    }
  });

  window.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (!state.projectPath) return;

    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "s" || e.key === "S") {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        $("btnMenuSave")?.click();
      } else {
        e.preventDefault();
        $("btnSplit")?.click();
      }
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      $("btnDeleteClip")?.click();
    } else if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) $("btnRedo")?.click();
      else $("btnUndo")?.click();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      $("btnStepBack")?.click();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      $("btnStepForward")?.click();
    }
  });
}

function bindStageGizmoInteractions() {
  const gizmo = $("stageGizmo");
  const stage = $("monitorStage");
  if (!gizmo || !stage) return;

  gizmo.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const clip = getSelectedClip();
    if (!clip) return;
    e.stopPropagation();

    const grip = e.target.closest("[data-grip]")?.getAttribute("data-grip") || "move";
    const startX = e.clientX;
    const startY = e.clientY;
    const sw = stage.clientWidth || 640;
    const sh = stage.clientHeight || 360;

    const origTf = {
      scale: Number(clip.scale ?? 1),
      offsetX: Number(clip.offsetX ?? 0),
      offsetY: Number(clip.offsetY ?? 0),
      rotation: Number(clip.rotation ?? 0),
    };
    let nextTf = { ...origTf };

    gizmo.setPointerCapture(e.pointerId);
    gizmo.classList.add("is-dragging");

    const onMove = (me) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;

      if (grip === "scale") {
        nextTf.scale = Math.max(0.1, Math.min(4.0, origTf.scale + (dx - dy) / 220));
      } else if (grip === "rot") {
        nextTf.rotation = Math.round(origTf.rotation + dx * 0.6);
      } else {
        nextTf.offsetX = Number((origTf.offsetX + dx / sw).toFixed(3));
        nextTf.offsetY = Number((origTf.offsetY + dy / sh).toFixed(3));
      }

      clip.scale = nextTf.scale;
      clip.offsetX = nextTf.offsetX;
      clip.offsetY = nextTf.offsetY;
      clip.rotation = nextTf.rotation;
      updateStageGizmo();
    };

    const onUp = async () => {
      gizmo.classList.remove("is-dragging");
      gizmo.removeEventListener("pointermove", onMove);
      gizmo.removeEventListener("pointerup", onUp);
      await dispatchCommand({
        op: "setClipTransform",
        clipId: clip.id,
        scale: nextTf.scale,
        offsetX: nextTf.offsetX,
        offsetY: nextTf.offsetY,
        rotation: nextTf.rotation,
      });
    };

    gizmo.addEventListener("pointermove", onMove);
    gizmo.addEventListener("pointerup", onUp);
  });

  gizmo.addEventListener("keydown", (e) => {
    const clip = getSelectedClip();
    if (!clip) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    let ox = Number(clip.offsetX ?? 0);
    let oy = Number(clip.offsetY ?? 0);
    if (e.key === "ArrowLeft") ox -= step;
    else if (e.key === "ArrowRight") ox += step;
    else if (e.key === "ArrowUp") oy -= step;
    else if (e.key === "ArrowDown") oy += step;
    else return;
    e.preventDefault();
    e.stopPropagation();
    dispatchCommand({
      op: "setClipTransform",
      clipId: clip.id,
      offsetX: Number(ox.toFixed(3)),
      offsetY: Number(oy.toFixed(3)),
    });
  });
}

async function uploadMediaFile(file) {
  if (!state.projectPath) return;
  try {
    showToast(`กำลังนำเข้าไฟล์ ${file.name}...`);
    const res = await fetch(
      `/api/upload?projectPath=${encodeURIComponent(state.projectPath)}&filename=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Project-Path": encodeURIComponent(state.projectPath),
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      },
    );
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Upload failed");
    if (data.view) state.view = data.view;
    renderStudio();
    showToast(`นำเข้าไฟล์ "${file.name}" สำเร็จ!`, "success");
  } catch (err) {
    showToast(`นำเข้าไฟล์ไม่สำเร็จ: ${err.message}`, "error");
  }
}

async function startExportJob() {
  if (!state.projectPath) return;
  try {
    $("btnStartExport").disabled = true;
    $("exportProgressBox").hidden = false;
    $("exportDoneBox").hidden = true;
    $("btnCancelExportJob").hidden = false;
    $("exportProgressFill").style.width = "4%";
    $("exportPercentText").textContent = "0%";
    $("exportStageText").textContent = "Starting Concat Engine Renderer...";

    const res = await api("/api/export/start", {
      method: "POST",
      body: JSON.stringify({
        path: state.projectPath,
        filename: $("exportFilename").value.trim() || "output.mp4",
        codec: $("exportCodec").value,
        crf: Number($("exportCrf").value) || 20,
        preset: $("exportPreset").value,
      }),
    });

    const jobId = res.job || res.jobId;
    const outputFile = res.output;
    state.activeExportJobId = jobId;

    clearInterval(state.exportPollTimer);
    state.exportPollTimer = setInterval(async () => {
      try {
        const job = await api(`/api/export/status?job=${encodeURIComponent(jobId)}`);
        const pct = Math.round((Number(job.progress) || 0) * 100);
        const st = job.state || job.status;
        $("exportProgressFill").style.width = `${Math.max(5, pct)}%`;
        $("exportPercentText").textContent = `${pct}%`;
        $("exportStageText").textContent = `${job.stage || st || "Rendering"}...`;

        if (st === "done" || st === "completed" || job.done) {
          clearInterval(state.exportPollTimer);
          $("exportProgressFill").style.width = "100%";
          $("exportPercentText").textContent = "100%";
          $("btnCancelExportJob").hidden = true;
          $("btnStartExport").disabled = false;
          $("exportDoneBox").hidden = false;
          const dlUrl = `/api/export/download?file=${encodeURIComponent(job.output || outputFile)}`;
          $("exportDownloadLink").href = dlUrl;
          $("exportPreviewVideo").src = dlUrl;
          showToast("เรนเดอร์วิดีโอ MP4 เสร็จสมบูรณ์!", "success");
        } else if (st === "failed" || st === "error" || st === "cancelled" || st === "canceled") {
          clearInterval(state.exportPollTimer);
          $("btnCancelExportJob").hidden = true;
          $("btnStartExport").disabled = false;
          showToast(`การส่งออกหยุดลง: ${job.error || st}`, "error");
        }
      } catch {
        clearInterval(state.exportPollTimer);
      }
    }, 350);
  } catch (err) {
    $("btnStartExport").disabled = false;
    showToast(`เริ่มส่งออกไม่สำเร็จ: ${err.message}`, "error");
  }
}

initApp();
