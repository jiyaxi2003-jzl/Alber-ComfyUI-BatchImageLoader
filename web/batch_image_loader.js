/**
 * ComfyUI Batch Image Loader - 前端界面
 *
 * 布局：左侧文件列表（自动序号 + 缩略图），右侧大图预览。
 * 按钮：选择文件夹 / 批量改名；下拉：排序方式；输入：起始序号。
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "ALBER-BatchImageLoader";
const API_BASE = "/batch_image_loader";
const PANEL_HEIGHT = 430;
const STYLE_ID = "bil-style";

/* ================================================================== */
/* 小工具                                                              */
/* ================================================================== */
function getWidget(node, name) {
  return node.widgets ? node.widgets.find((w) => w.name === name) : undefined;
}

function humanSize(bytes) {
  if (bytes === undefined || bytes === null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function humanTime(seconds) {
  if (!seconds) return "-";
  const d = new Date(seconds * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function viewUrl(file) {
  return `${API_BASE}/view?path=${encodeURIComponent(file.path)}&t=${file.mtime || 0}`;
}

function thumbUrl(file, size = 96) {
  return `${API_BASE}/thumb?path=${encodeURIComponent(file.path)}&t=${file.mtime || 0}&size=${size}`;
}

/** 隐藏 / 显示一个 widget（litegraph 通过 computeSize 控制占位高度） */
function setWidgetVisible(widget, visible) {
  if (!widget) return;
  if (!widget.__bilBackup) {
    widget.__bilBackup = { computeSize: widget.computeSize, type: widget.type };
  }
  if (visible) {
    widget.computeSize = widget.__bilBackup.computeSize;
    widget.type = widget.__bilBackup.type;
    widget.hidden = false;
  } else {
    widget.computeSize = () => [0, -4];
    widget.type = "hidden";
    widget.hidden = true;
  }
}

/* ================================================================== */
/* 样式                                                               */
/* ================================================================== */
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.bil-root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  height: ${PANEL_HEIGHT}px;
  padding: 6px;
  border: 1px solid var(--border-color, #444);
  border-radius: 8px;
  background: var(--comfy-menu-bg, #1f1f1f);
  color: var(--input-text, #e6e6e6);
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 12px;
  overflow: hidden;
  user-select: none;
}
.bil-toolbar { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.bil-count { flex: 0 0 auto; opacity: .7; white-space: nowrap; }
.bil-filter {
  flex: 1 1 auto; min-width: 0; height: 22px;
  background: var(--comfy-input-bg, #2a2a2a);
  border: 1px solid var(--border-color, #444);
  border-radius: 5px; color: inherit; padding: 0 6px; font-size: 12px; outline: none;
}
.bil-filter:focus { border-color: #3b82f6; }
.bil-icon-btn {
  flex: 0 0 auto; width: 26px; height: 22px; cursor: pointer; line-height: 1;
  background: var(--comfy-input-bg, #2a2a2a);
  border: 1px solid var(--border-color, #444);
  border-radius: 5px; color: inherit; font-size: 13px;
}
.bil-icon-btn:hover { border-color: #3b82f6; }
.bil-body { flex: 1 1 auto; display: flex; gap: 6px; min-height: 0; }
.bil-list-wrap {
  flex: 0 0 57%; min-width: 0; overflow-y: auto; overflow-x: hidden;
  border: 1px solid var(--border-color, #3a3a3a); border-radius: 6px;
  background: rgba(0, 0, 0, .18);
}
.bil-list { list-style: none; margin: 0; padding: 0; }
.bil-item {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 6px; cursor: pointer;
  border-bottom: 1px solid rgba(127, 127, 127, .16);
}
.bil-item:hover { background: rgba(127, 127, 127, .14); }
.bil-item-selected { background: rgba(59, 130, 246, .38) !important; }
.bil-idx {
  flex: 0 0 30px; text-align: right; opacity: .55;
  font-variant-numeric: tabular-nums; font-size: 11px;
}
.bil-thumb {
  flex: 0 0 34px; width: 34px; height: 34px; object-fit: cover;
  border-radius: 3px; background: rgba(0, 0, 0, .4); display: block;
}
.bil-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bil-size { flex: 0 0 auto; opacity: .5; font-size: 11px; }
.bil-empty { padding: 16px; text-align: center; opacity: .5; line-height: 1.6; }
.bil-preview {
  flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px;
  border: 1px solid var(--border-color, #3a3a3a); border-radius: 6px;
  background: rgba(0, 0, 0, .18); padding: 4px;
}
.bil-preview-empty {
  flex: 1 1 auto; display: flex; align-items: center; justify-content: center;
  opacity: .5; text-align: center;
}
.bil-preview-img {
  flex: 1 1 auto; min-height: 0; width: 100%; object-fit: contain;
  border-radius: 4px; background: rgba(0, 0, 0, .35); display: none;
}
.bil-preview-meta {
  flex: 0 0 auto; font-size: 11px; line-height: 1.4; opacity: .72;
  white-space: pre-line; word-break: break-all; max-height: 44px; overflow: hidden;
}
.bil-status {
  flex: 0 0 auto; font-size: 11px; opacity: .58;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 对话框 */
.bil-mask {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .55);
}
.bil-dialog {
  width: min(580px, 92vw); max-height: 82vh;
  display: flex; flex-direction: column; gap: 8px; padding: 14px;
  border-radius: 10px; border: 1px solid var(--border-color, #444);
  background: var(--comfy-menu-bg, #222); color: var(--input-text, #e6e6e6);
  box-shadow: 0 14px 48px rgba(0, 0, 0, .55);
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 13px;
}
.bil-dialog-title { font-size: 14px; font-weight: 600; }
.bil-dialog-path { display: flex; gap: 6px; }
.bil-input {
  flex: 1 1 auto; min-width: 0; height: 26px; padding: 0 7px;
  background: var(--comfy-input-bg, #2a2a2a); color: inherit;
  border: 1px solid var(--border-color, #444); border-radius: 5px;
  font-size: 12px; outline: none;
}
.bil-input:focus { border-color: #3b82f6; }
.bil-btn {
  height: 26px; padding: 0 12px; cursor: pointer; white-space: nowrap;
  background: var(--comfy-input-bg, #2f2f2f); color: inherit;
  border: 1px solid var(--border-color, #444); border-radius: 5px; font-size: 12px;
}
.bil-btn:hover { border-color: #3b82f6; }
.bil-btn:disabled { opacity: .45; cursor: not-allowed; }
.bil-btn-primary { background: #2f6fd0; border-color: #2f6fd0; color: #fff; }
.bil-btn-primary:hover { background: #3b82f6; border-color: #3b82f6; }
.bil-btn-ghost { background: transparent; }
.bil-dir-list {
  flex: 1 1 auto; min-height: 180px; max-height: 46vh; overflow-y: auto;
  border: 1px solid var(--border-color, #3a3a3a); border-radius: 6px;
  background: rgba(0, 0, 0, .18); padding: 3px;
}
.bil-dir-row {
  display: flex; align-items: center; gap: 7px;
  padding: 4px 7px; border-radius: 4px; cursor: pointer;
}
.bil-dir-row:hover { background: rgba(127, 127, 127, .18); }
.bil-dir-selected { background: rgba(59, 130, 246, .38) !important; }
.bil-dir-icon { flex: 0 0 auto; }
.bil-dir-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bil-dialog-hint { font-size: 11px; opacity: .62; min-height: 15px; }
.bil-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
.bil-form { display: flex; flex-direction: column; gap: 4px; }
.bil-form-inline { flex-direction: row; align-items: center; gap: 8px; }
.bil-form-inline .bil-input { flex: 0 0 110px; }
.bil-form label { font-size: 12px; opacity: .75; }
.bil-tip { font-size: 11px; opacity: .55; line-height: 1.5; }
.bil-preview-box {
  border: 1px solid var(--border-color, #3a3a3a); border-radius: 6px;
  background: rgba(0, 0, 0, .18); padding: 6px; max-height: 220px; overflow-y: auto;
}
.bil-preview-title { font-size: 11px; opacity: .6; margin-bottom: 4px; }
.bil-preview-lines { font-size: 12px; line-height: 1.55; white-space: pre-line; word-break: break-all; }
`;
  document.head.appendChild(style);
}

/* ================================================================== */
/* 节点主界面                                                          */
/* ================================================================== */
function setupNode(node) {
  ensureStyle();

  node._bil = {
    folder: "",
    files: [],
    selected: -1,
    filter: "",
    requestId: 0,
    timer: null,
    listEl: null,
    previewImg: null,
    previewEmpty: null,
    previewMeta: null,
    countEl: null,
    statusEl: null,
  };

  addButtons(node);
  buildPanel(node);
  hideInternalWidgets(node);
  updateModeVisibility(node);
  hookWidgets(node);

  if (!node.size || node.size[0] < 420) {
    node.setSize([540, 720]);
  }
  node.setDirtyCanvas?.(true, true);
  scheduleRefresh(node, 120);
}

function addButtons(node) {
  node.addWidget("button", "📂 选择文件夹", null, () => openFolderDialog(node));
  node.addWidget("button", "✏️ 批量改名", null, () => openRenameDialog(node));
}

function hideInternalWidgets(node) {
  // files_json 由 JS 维护，不在界面显示
  setWidgetVisible(getWidget(node, "files_json"), false);
}

function updateModeVisibility(node) {
  const modeWidget = getWidget(node, "mode");
  const indexWidget = getWidget(node, "index");
  if (!modeWidget || !indexWidget) return;
  const isSingle = String(modeWidget.value) === "single";
  setWidgetVisible(indexWidget, isSingle);
  node.setDirtyCanvas?.(true, true);
}

function buildPanel(node) {
  const state = node._bil;

  const root = el("div", "bil-root");

  /* ---- 顶部工具栏 ---- */
  const toolbar = el("div", "bil-toolbar");
  state.countEl = el("span", "bil-count", "—");
  const filterEl = el("input", "bil-filter");
  filterEl.type = "text";
  filterEl.placeholder = "过滤文件名…";
  const refreshBtn = el("button", "bil-icon-btn", "⟳");
  refreshBtn.title = "重新扫描当前文件夹";
  toolbar.append(state.countEl, filterEl, refreshBtn);

  /* ---- 主体：列表 + 预览 ---- */
  const body = el("div", "bil-body");
  const listWrap = el("div", "bil-list-wrap");
  state.listEl = el("ul", "bil-list");
  listWrap.appendChild(state.listEl);

  const preview = el("div", "bil-preview");
  state.previewEmpty = el("div", "bil-preview-empty", "未选择图片");
  state.previewImg = el("img", "bil-preview-img");
  state.previewMeta = el("div", "bil-preview-meta", "");
  preview.append(state.previewEmpty, state.previewImg, state.previewMeta);

  body.append(listWrap, preview);

  state.statusEl = el("div", "bil-status", "正在初始化…");
  root.append(toolbar, body, state.statusEl);

  /* ---- 挂到节点上 ---- */
  if (typeof node.addDOMWidget !== "function") {
    console.warn("[ALBER] 当前前端不支持 addDOMWidget，请升级 ComfyUI 前端。");
    node.addWidget("text", "提示", "请升级 ComfyUI 前端以使用图片列表界面", null, {});
    return;
  }

  const widget = node.addDOMWidget("batch_browser", "batch_browser", root, {
    serialize: false,
    hideOnZoom: false,
    getValue: () => "",
    setValue: () => {},
  });
  widget.computeSize = (width) => [width, PANEL_HEIGHT];
  widget.serialize = false;

  /* ---- 事件 ---- */
  refreshBtn.addEventListener("click", () => refresh(node));
  filterEl.addEventListener("input", () => {
    state.filter = filterEl.value.trim().toLowerCase();
    renderList(node);
  });
}

/* ================================================================== */
/* widget 勾子                                                         */
/* ================================================================== */
function hookWidgets(node) {
  const bind = (name, handler) => {
    const widget = getWidget(node, name);
    if (!widget) return;
    const original = widget.callback;
    widget.callback = function (...args) {
      const result = typeof original === "function" ? original.apply(this, args) : undefined;
      try {
        handler(args[0]);
      } catch (err) {
        console.error("[ALBER]", err);
      }
      return result;
    };
  };

  bind("folder", () => scheduleRefresh(node, 700));
  bind("sort_by", () => scheduleRefresh(node, 0));
  bind("order", () => scheduleRefresh(node, 0));
  bind("mode", () => updateModeVisibility(node));
  bind("start_index", () => renderList(node));
}

function scheduleRefresh(node, delay = 0) {
  const state = node._bil;
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    refresh(node);
  }, delay);
}

/* ================================================================== */
/* 数据刷新                                                            */
/* ================================================================== */
async function refresh(node) {
  const state = node._bil;
  if (!state) return;

  const folderWidget = getWidget(node, "folder");
  const sortWidget = getWidget(node, "sort_by");
  const orderWidget = getWidget(node, "order");
  const previousName = state.files[state.selected]?.name;

  const requestId = ++state.requestId;
  setStatus(node, "扫描中…");

  try {
    const query = new URLSearchParams({
      folder: folderWidget?.value ?? "",
      sort_by: sortWidget?.value ?? "filename",
      order: orderWidget?.value ?? "ascending",
    });
    const response = await api.fetchApi(`${API_BASE}/list?${query.toString()}`);
    const data = await response.json();
    if (requestId !== state.requestId) return;

    if (data.error) {
      state.files = [];
      state.selected = -1;
      renderList(node);
      renderPreview(node);
      syncFilesJson(node);
      setStatus(node, `⚠ ${data.error}`);
      return;
    }

    state.folder = data.folder || "";
    state.files = data.files || [];
    state.selected = state.files.length ? 0 : -1;
    if (previousName) {
      const found = state.files.findIndex((f) => f.name === previousName);
      if (found >= 0) state.selected = found;
    }

    renderList(node);
    renderPreview(node);
    syncFilesJson(node);

    setStatus(node, `共 ${state.files.length} 张 · ${data.folder}`);
  } catch (err) {
    if (requestId !== state.requestId) return;
    setStatus(node, `请求失败：${err}`);
  }
}

function syncFilesJson(node) {
  const state = node._bil;
  const widget = getWidget(node, "files_json");
  if (!widget || !state) return;
  widget.value = JSON.stringify({ folder: state.folder || "", files: state.files.map((f) => f.name) });
  node.graph?.setDirtyCanvas?.(true, true);
}

function setStatus(node, text) {
  const state = node._bil;
  if (state?.statusEl) state.statusEl.textContent = text;
}

/* ================================================================== */
/* 渲染                                                                */
/* ================================================================== */
function renderList(node) {
  const state = node._bil;
  if (!state?.listEl) return;

  const startWidget = getWidget(node, "start_index");
  const start = Number(startWidget?.value ?? 1) || 0;

  state.listEl.textContent = "";
  const fragment = document.createDocumentFragment();
  let shown = 0;

  state.files.forEach((file, index) => {
    if (state.filter && !file.name.toLowerCase().includes(state.filter)) return;
    shown += 1;

    const item = el("li", "bil-item" + (index === state.selected ? " bil-item-selected" : ""));
    item.dataset.index = String(index);
    item.title = `${file.name}\n${humanSize(file.size)} · ${humanTime(file.ctime)}`;

    item.append(el("span", "bil-idx", String(start + index)));

    const thumb = el("img", "bil-thumb");
    thumb.loading = "lazy";
    thumb.alt = "";
    thumb.src = thumbUrl(file, 96);
    thumb.addEventListener("error", () => {
      thumb.style.visibility = "hidden";
    });
    item.append(thumb);

    item.append(el("span", "bil-name", file.name));
    item.append(el("span", "bil-size", humanSize(file.size)));

    item.addEventListener("click", () => selectIndex(node, index));
    fragment.appendChild(item);
  });

  if (shown === 0) {
    const empty = el("li", "bil-empty");
    empty.textContent = state.files.length
      ? "没有匹配的图片"
      : "文件夹中没有图片\n点击上方「📂 选择文件夹」开始";
    fragment.appendChild(empty);
  }

  state.listEl.appendChild(fragment);

  if (state.countEl) {
    state.countEl.textContent = state.filter
      ? `${shown}/${state.files.length} 张`
      : `${state.files.length} 张`;
  }
}

function renderPreview(node) {
  const state = node._bil;
  if (!state?.previewImg) return;

  const file = state.files[state.selected];
  if (!file) {
    state.previewImg.style.display = "none";
    state.previewImg.removeAttribute("src");
    state.previewEmpty.style.display = "flex";
    state.previewMeta.textContent = "";
    return;
  }

  state.previewEmpty.style.display = "none";
  state.previewImg.style.display = "block";
  state.previewImg.src = viewUrl(file);
  state.previewMeta.textContent =
    `${file.name}\n${humanSize(file.size)} · ${humanTime(file.ctime)}`;
}

function selectIndex(node, index) {
  const state = node._bil;
  if (!state) return;
  state.selected = index;

  if (state.listEl) {
    for (const child of state.listEl.children) {
      child.classList?.toggle("bil-item-selected", Number(child.dataset?.index) === index);
    }
  }
  renderPreview(node);

  const modeWidget = getWidget(node, "mode");
  if (modeWidget && String(modeWidget.value) === "single") {
    const indexWidget = getWidget(node, "index");
    if (indexWidget) {
      indexWidget.value = index;
      node.setDirtyCanvas?.(true, true);
    }
  }
}

/* ================================================================== */
/* 对话框基础                                                          */
/* ================================================================== */
function openMask(box) {
  const mask = el("div", "bil-mask");
  mask.appendChild(box);
  const close = () => {
    mask.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  mask.addEventListener("mousedown", (event) => {
    if (event.target === mask) close();
  });
  document.body.appendChild(mask);
  return close;
}

/* ================================================================== */
/* 选择文件夹                                                          */
/* ================================================================== */
function openFolderDialog(node) {
  const box = el("div", "bil-dialog");
  box.append(el("div", "bil-dialog-title", "选择图片文件夹"));

  const pathRow = el("div", "bil-dialog-path");
  const pathInput = el("input", "bil-input bil-dir-path");
  pathInput.type = "text";
  pathInput.spellcheck = false;
  pathInput.placeholder = "可直接粘贴绝对路径，留空 = ComfyUI input 目录";
  const goBtn = el("button", "bil-btn", "前往");
  pathRow.append(pathInput, goBtn);

  const dirList = el("div", "bil-dir-list");
  const hint = el("div", "bil-dialog-hint", "");

  const actions = el("div", "bil-dialog-actions");
  const cancelBtn = el("button", "bil-btn bil-btn-ghost bil-dialog-cancel", "取消");
  const okBtn = el("button", "bil-btn bil-btn-primary bil-dialog-ok", "使用此文件夹");
  actions.append(cancelBtn, okBtn);

  box.append(pathRow, dirList, hint, actions);

  const close = openMask(box);

  let currentPath = "";
  let selectedPath = null;

  function makeRow(icon, label, path) {
    const row = el("div", "bil-dir-row");
    row.append(el("span", "bil-dir-icon", icon), el("span", "bil-dir-name", label));
    row.addEventListener("click", () => {
      selectedPath = path;
      for (const child of dirList.children) child.classList.remove("bil-dir-selected");
      row.classList.add("bil-dir-selected");
    });
    row.addEventListener("dblclick", () => load(path));
    return row;
  }

  async function load(path) {
    hint.textContent = "读取中…";
    try {
      const response = await api.fetchApi(`${API_BASE}/browse?path=${encodeURIComponent(path || "")}`);
      const data = await response.json();
      if (data.error) {
        hint.textContent = `⚠ ${data.error}`;
        return;
      }
      currentPath = data.path;
      selectedPath = data.path;
      pathInput.value = data.path;
      dirList.textContent = "";

      if (data.parent) {
        dirList.appendChild(makeRow("⬆", "上级目录", data.parent));
      }
      (data.drives || []).forEach((drive) => dirList.appendChild(makeRow("💽", drive.name, drive.path)));
      (data.dirs || []).forEach((dir) => dirList.appendChild(makeRow("📁", dir.name, dir.path)));

      hint.textContent = `当前文件夹含 ${data.image_count} 张图片 · 单击选中，双击进入`;
      okBtn.disabled = false;
      dirList.scrollTop = 0;
    } catch (err) {
      hint.textContent = `读取失败：${err}`;
    }
  }

  goBtn.addEventListener("click", () => load(pathInput.value.trim()));
  pathInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      load(pathInput.value.trim());
    }
  });
  cancelBtn.addEventListener("click", close);
  okBtn.addEventListener("click", () => {
    const target = selectedPath || currentPath || pathInput.value.trim();
    const widget = getWidget(node, "folder");
    if (widget) widget.value = target;
    close();
    refresh(node);
  });

  load(getWidget(node, "folder")?.value || "");
  setTimeout(() => pathInput.focus(), 30);
}

/* ================================================================== */
/* 批量改名                                                            */
/* ================================================================== */
function renderName(pattern, index, fileName) {
  const dot = fileName.lastIndexOf(".");
  const hasExt = dot > 0;
  const stem = hasExt ? fileName.slice(0, dot) : fileName;
  const ext = hasExt ? fileName.slice(dot + 1) : "";

  let out = String(pattern).replace(
    /\{(i|index0|n|name|ext)(?::0?(\d+)d)?\}/g,
    (match, token, pad) => {
      let value;
      if (token === "i" || token === "n") value = String(index);
      else if (token === "index0") value = String(index - 1);
      else if (token === "name") value = stem;
      else value = ext;
      if (pad && (token === "i" || token === "n" || token === "index0")) {
        value = value.padStart(parseInt(pad, 10), "0");
      }
      return value;
    }
  );

  out = out.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().replace(/[ .]+$/, "");
  if (!out) return fileName;
  if (!/\.[^./\\]+$/.test(out) && ext) out += `.${ext}`;
  return out;
}

function openRenameDialog(node) {
  const state = node._bil;
  if (!state || !state.files.length) {
    alert("列表为空，请先选择包含图片的文件夹。");
    return;
  }

  const startWidget = getWidget(node, "start_index");
  const defaultStart = Number(startWidget?.value ?? 1) || 1;

  const box = el("div", "bil-dialog");
  box.append(el("div", "bil-dialog-title", `批量重命名（${state.files.length} 张图片）`));

  const patternForm = el("div", "bil-form");
  patternForm.appendChild(el("label", "", "文件名模板"));
  const patternInput = el("input", "bil-input bil-rename-pattern");
  patternInput.type = "text";
  patternInput.spellcheck = false;
  patternInput.value = "img_{i:03d}";
  patternForm.appendChild(patternInput);
  patternForm.appendChild(el("div", "bil-tip",
    "可用变量：{i} 序号 · {i:03d} 补零序号 · {index0} 从 0 开始 · {name} 原名 · {ext} 扩展名"));

  const startForm = el("div", "bil-form bil-form-inline");
  startForm.appendChild(el("label", "", "起始序号"));
  const startInput = el("input", "bil-input bil-rename-start");
  startInput.type = "number";
  startInput.min = "0";
  startInput.step = "1";
  startInput.value = String(defaultStart);
  startForm.appendChild(startInput);

  const previewBox = el("div", "bil-preview-box");
  previewBox.appendChild(el("div", "bil-preview-title", "预览（前 8 张）"));
  const previewLines = el("div", "bil-preview-lines", "");
  previewBox.appendChild(previewLines);

  const hint = el("div", "bil-dialog-hint", "");

  const actions = el("div", "bil-dialog-actions");
  const cancelBtn = el("button", "bil-btn bil-btn-ghost bil-dialog-cancel", "取消");
  const okBtn = el("button", "bil-btn bil-btn-primary bil-dialog-ok", "开始重命名");
  actions.append(cancelBtn, okBtn);

  box.append(patternForm, startForm, previewBox, hint, actions);

  const close = openMask(box);

  function currentStart() {
    const value = parseInt(startInput.value, 10);
    return Number.isFinite(value) ? value : 0;
  }

  function updatePreview() {
    const pattern = patternInput.value;
    const start = currentStart();
    const lines = [];
    const seen = new Set();
    let duplicated = false;

    state.files.forEach((file, position) => {
      const newName = renderName(pattern, start + position, file.name);
      if (seen.has(newName.toLowerCase())) duplicated = true;
      seen.add(newName.toLowerCase());
      if (position < 8) lines.push(`${file.name}   →   ${newName}`);
    });

    if (state.files.length > 8) lines.push(`… 其余 ${state.files.length - 8} 张同理`);

    previewLines.textContent = lines.join("\n");

    if (!pattern.trim()) {
      hint.textContent = "⚠ 模板不能为空";
      okBtn.disabled = true;
    } else if (duplicated) {
      hint.textContent = "⚠ 模板生成了重复文件名，请加入 {i} 序号";
      okBtn.disabled = true;
    } else {
      hint.textContent = `将按列表顺序重命名 ${state.files.length} 个文件，重命名前请确认没有同名的其他文件`;
      okBtn.disabled = false;
    }
  }

  patternInput.addEventListener("input", updatePreview);
  startInput.addEventListener("input", updatePreview);
  cancelBtn.addEventListener("click", close);

  okBtn.addEventListener("click", async () => {
    okBtn.disabled = true;
    hint.textContent = "正在重命名…";
    try {
      const response = await api.fetchApi(`${API_BASE}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder: getWidget(node, "folder")?.value || "",
          files: state.files.map((file) => file.name),
          pattern: patternInput.value,
          start: currentStart(),
        }),
      });
      const data = await response.json();
      if (data.error) {
        hint.textContent = `⚠ ${data.error}`;
        okBtn.disabled = false;
        return;
      }
      close();
      await refresh(node);
    } catch (err) {
      hint.textContent = `⚠ 重命名失败：${err}`;
      okBtn.disabled = false;
    }
  });

  updatePreview();
  setTimeout(() => {
    patternInput.focus();
    patternInput.select();
  }, 30);
}

/* ================================================================== */
/* 注册扩展                                                            */
/* ================================================================== */
app.registerExtension({
  name: "ALBER-BatchImageLoader.UI",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
      try {
        setupNode(this);
      } catch (err) {
        console.error("[ALBER] 初始化界面失败", err);
      }
      return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      if (this._bil) scheduleRefresh(this, 150);
      return result;
    };
  },
});
