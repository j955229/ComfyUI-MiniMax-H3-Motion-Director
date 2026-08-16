import { api } from "../../scripts/api.js";
import {
    MIXED_SEGMENT_MODES,
    backendTaskPreview,
    duplicateMixedSegment,
    legalOriginsForSlot,
    moveMixedSegment,
    newMixedSegment,
    normalizeMixedTimeline,
    referencedDependents,
    validateMixedReferences,
} from "./minimax_mixed_state.mjs";
import {
    inputRelativePath,
    listMaterialLibrary,
    materializeMaterial,
} from "./minimax_material_library_api.mjs";

const STYLE_ID = "mmx-mixed-mode-styles";
const CHUNK_BYTES = 8 * 1024 * 1024;
const CHUNK_THRESHOLD = 80 * 1024 * 1024;

const MODE_LABELS = Object.freeze({
    t2v: "T2V",
    i2v: "I2V",
    fl2v: "FL2V",
    r2v: "R2V",
    source_video: "Source Video",
});

const ROLE_LABELS = Object.freeze({
    identity: "Identity",
    i2v_start: "Start Frame",
    fl2v_first: "First Frame",
    fl2v_last: "Last Frame",
});

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.mmx-mixed-root{height:100%;min-height:0;display:grid;grid-template-rows:auto minmax(180px,34%) minmax(0,1fr);gap:8px;padding:4px;box-sizing:border-box;color:#ddd;font:12px/1.35 ui-sans-serif,system-ui,-apple-system,sans-serif}
.mmx-mixed-global{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px;border:1px solid #34383c;border-radius:8px;background:#181b1e}.mmx-mixed-global strong{color:#fff;margin-right:auto}.mmx-mixed-global label{display:flex;align-items:center;gap:5px;color:#9ca7ae}.mmx-mixed-global input,.mmx-mixed-global select{width:82px}
.mmx-mixed-panel{min-width:0;min-height:0;border:1px solid #34383c;border-radius:8px;background:#15181b;overflow:hidden}.mmx-mixed-panel-head{height:38px;display:flex;align-items:center;gap:7px;padding:0 9px;border-bottom:1px solid #303438;background:#1b1f22}.mmx-mixed-panel-head strong{color:#f0f3f5}.mmx-mixed-panel-head .spacer{flex:1}
.mmx-mixed-btn{border:1px solid #46515a;border-radius:6px;background:#252b30;color:#dce3e8;padding:5px 9px;cursor:pointer}.mmx-mixed-btn:hover{border-color:#6d899d;background:#2d363d;color:#fff}.mmx-mixed-btn.primary{border-color:#3f9565;background:#1d4d34;color:#d9ffe8}.mmx-mixed-btn.danger{border-color:#704343;color:#ffbaba;background:#3d2323}.mmx-mixed-btn:disabled{opacity:.35;cursor:not-allowed}
.mmx-mixed-timeline{height:100%;display:flex;flex-direction:column}.mmx-mixed-cards{flex:1;min-height:0;display:flex;gap:8px;overflow:auto;padding:9px;align-items:stretch}.mmx-mixed-card{position:relative;flex:0 0 190px;min-height:118px;padding:9px;border:1px solid #3e464d;border-radius:8px;background:#1b2024;cursor:pointer;box-sizing:border-box}.mmx-mixed-card.selected{border-color:#4fff8f;box-shadow:inset 0 0 0 1px rgba(79,255,143,.25)}.mmx-mixed-card.invalid{border-color:#e46d6d}.mmx-mixed-card-top{display:flex;align-items:center;gap:6px}.mmx-mixed-card-index{font-weight:800;color:#f5f5f5}.mmx-mixed-mode-badge{padding:2px 6px;border-radius:10px;background:#29343d;color:#9fd4ff;font-size:10px}.mmx-mixed-backend{margin-left:auto;color:#78838b;font:10px ui-monospace,Consolas,monospace}.mmx-mixed-card-prompt{margin-top:8px;height:34px;overflow:hidden;color:#bac3c9}.mmx-mixed-card-meta{margin-top:6px;color:#818c94;font-size:10px}.mmx-mixed-card-actions{position:absolute;left:8px;right:8px;bottom:7px;display:flex;gap:4px}.mmx-mixed-card-actions button{flex:1;padding:3px 4px;font-size:10px}.mmx-mixed-runbox{position:absolute;right:7px;top:7px;z-index:2}.mmx-mixed-runbox input{accent-color:#4fff8f}
.mmx-mixed-editor-wrap{height:100%;min-height:0;display:grid;grid-template-columns:minmax(0,2fr) minmax(270px,1fr);gap:8px}.mmx-mixed-editor,.mmx-mixed-continuity{min-height:0;overflow:auto;padding:10px}.mmx-mixed-field{margin-bottom:10px}.mmx-mixed-field>label{display:block;margin-bottom:4px;color:#9eabb3;font-size:11px}.mmx-mixed-field input,.mmx-mixed-field select,.mmx-mixed-field textarea{width:100%;box-sizing:border-box;border:1px solid #3e474f;border-radius:6px;background:#101316;color:#eceff1;padding:7px;outline:none}.mmx-mixed-field textarea{min-height:105px;resize:vertical}.mmx-mixed-field input:focus,.mmx-mixed-field select:focus,.mmx-mixed-field textarea:focus{border-color:#638ba6}.mmx-mixed-inline{display:flex;gap:7px;align-items:center}.mmx-mixed-inline>*{min-width:0}.mmx-mixed-inline .grow{flex:1}.mmx-mixed-help{font-size:10px;color:#78858d;margin-top:4px}.mmx-mixed-warning{padding:7px 9px;border-radius:6px;background:#3b2b19;color:#ffcb8d;margin:7px 0}.mmx-mixed-error{padding:7px 9px;border-radius:6px;background:#3a2020;color:#ff9e9e;margin:7px 0}
.mmx-mixed-media-block{border:1px solid #333b41;border-radius:7px;background:#181d21;padding:8px;margin-bottom:8px}.mmx-mixed-media-title{display:flex;align-items:center;gap:6px;margin-bottom:7px;color:#e3e8eb}.mmx-mixed-media-title strong{margin-right:auto}.mmx-mixed-media-row{display:flex;align-items:center;gap:6px;padding:5px 0;border-top:1px solid #282e33}.mmx-mixed-media-row:first-of-type{border-top:0}.mmx-mixed-media-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#b9c3ca}.mmx-mixed-media-origin{font-size:10px;color:#7eb8e6}.mmx-mixed-media-row input[type=number]{width:78px}.mmx-mixed-media-row select{width:130px}
.mmx-mixed-source-preview{height:135px;display:flex;align-items:center;justify-content:center;margin:7px 0;border:1px solid #30383e;border-radius:6px;background:#0c0f11;overflow:hidden}.mmx-mixed-source-preview video{width:100%;height:100%;object-fit:contain}.mmx-mixed-source-empty{color:#66727a}.mmx-mixed-range{display:grid;grid-template-columns:1fr 1fr auto;gap:7px;align-items:end}.mmx-mixed-range label{font-size:10px;color:#89959c}.mmx-mixed-range input{margin-top:3px}
.mmx-mixed-continuity h3{margin:0 0 9px;color:#eef2f4;font-size:13px}.mmx-mixed-toggle{display:flex;align-items:center;gap:9px;padding:8px;border:1px solid #333b42;border-radius:7px;background:#191e22;margin-bottom:7px}.mmx-mixed-toggle input{accent-color:#4fff8f}.mmx-mixed-deps{margin-top:12px;padding-top:10px;border-top:1px solid #30363b;color:#8d989f;font-size:10px}.mmx-mixed-status{min-height:20px;padding:3px 9px;color:#8fa2ad;font-size:10px}.mmx-mixed-status.error{color:#ff8f8f}.mmx-mixed-status.ok{color:#73d69a}
.mmx-mixed-picker-layer{position:absolute;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72)}.mmx-mixed-picker{width:min(760px,88%);height:min(600px,84%);display:flex;flex-direction:column;border:1px solid #48535c;border-radius:10px;background:#171c20;box-shadow:0 18px 60px #000}.mmx-mixed-picker-head{height:42px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid #343b41}.mmx-mixed-picker-head strong{margin-right:auto}.mmx-mixed-picker-list{flex:1;min-height:0;overflow:auto;padding:9px;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;align-content:start}.mmx-mixed-picker-item{min-height:74px;text-align:left;border:1px solid #3d464e;border-radius:7px;background:#20262b;color:#dbe2e6;padding:9px;cursor:pointer}.mmx-mixed-picker-item:hover{border-color:#5f87a3;background:#28323a}.mmx-mixed-picker-item small{display:block;margin-top:5px;color:#829099}.mmx-mixed-picker-empty{grid-column:1/-1;text-align:center;color:#7e8a91;padding:40px}
`;
    document.head.appendChild(style);
}

function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function uid() {
    if (globalThis.crypto?.randomUUID) return `seg_${crypto.randomUUID()}`;
    return `seg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function mediaName(item) {
    return String(item?.title || item?.original_name || item?.imageFile || item?.videoFile || item?.audioFile || item?.fileName || item?.name || "未选择");
}

function relativePath(upload) {
    const name = upload?.name || upload?.filename || "";
    const sub = String(upload?.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return sub ? `${sub}/${name}` : name;
}

async function responseText(resp) {
    try { return await resp.text(); } catch { return `HTTP ${resp.status}`; }
}

async function uploadSmall(file) {
    const body = new FormData();
    body.append("image", file);
    body.append("type", "input");
    body.append("overwrite", "false");
    const resp = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!resp.ok) throw new Error((await responseText(resp)) || `Upload failed (${resp.status})`);
    return resp.json();
}

async function uploadChunked(file, onProgress) {
    const uploadId = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`;
    const total = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
    let result = null;
    for (let i = 0; i < total; i += 1) {
        const start = i * CHUNK_BYTES;
        const end = Math.min(file.size, start + CHUNK_BYTES);
        const body = new FormData();
        body.append("upload_id", uploadId);
        body.append("filename", file.name);
        body.append("chunk_index", String(i));
        body.append("total_chunks", String(total));
        body.append("chunk", file.slice(start, end), `${file.name}.${i}.part`);
        const resp = await api.fetchApi("/minimax/motion-director/upload_chunk", { method: "POST", body });
        if (!resp.ok) throw new Error((await responseText(resp)) || `Chunk upload failed (${resp.status})`);
        result = await resp.json();
        onProgress?.((i + 1) / total);
    }
    return result;
}

async function uploadInput(file, { onProgress } = {}) {
    if (file.size > CHUNK_THRESHOLD && /^video\//i.test(file.type || "")) {
        return uploadChunked(file, onProgress);
    }
    try {
        return await uploadSmall(file);
    } catch (error) {
        if (/too large|413|request entity/i.test(String(error?.message || error)) && /^video\//i.test(file.type || "")) {
            return uploadChunked(file, onProgress);
        }
        throw error;
    }
}

function chooseFile(accept) {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept || "*/*";
        input.style.display = "none";
        document.body.appendChild(input);
        input.addEventListener("change", () => {
            const file = input.files?.[0] || null;
            input.remove();
            resolve(file);
        }, { once: true });
        input.addEventListener("cancel", () => { input.remove(); resolve(null); }, { once: true });
        input.click();
    });
}

async function probeVideo(videoFile) {
    const resp = await api.fetchApi("/minimax/motion-director/probe_video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoFile }),
    });
    if (!resp.ok) throw new Error((await responseText(resp)) || `Video probe failed (${resp.status})`);
    return resp.json();
}

function viewUrl(item) {
    const path = String(item?.videoFile || item?.imageFile || "").replace(/\\/g, "/");
    if (!path) return "";
    const slash = path.lastIndexOf("/");
    const filename = slash >= 0 ? path.slice(slash + 1) : path;
    const subfolder = slash >= 0 ? path.slice(0, slash) : "";
    const params = new URLSearchParams({ filename, type: "input" });
    if (subfolder) params.set("subfolder", subfolder);
    const raw = `/view?${params.toString()}`;
    return typeof api.apiURL === "function" ? api.apiURL(raw) : raw;
}

function setDescriptorIndex(items) {
    return (items || []).map((item, index) => ({ ...item, index }));
}

function findResultRef(seg, role) {
    return (seg.inputs?.resultRefs || []).find((ref) => ref?.role === role) || null;
}

function removeResultRefs(seg, role) {
    seg.inputs.resultRefs = (seg.inputs?.resultRefs || []).filter((ref) => ref?.role !== role);
}

function identityStaticKey(seg) {
    return seg.mode === "source_video" ? "identityPictures" : "pictures";
}

function identityTotal(seg) {
    const key = identityStaticKey(seg);
    const staticCount = Array.isArray(seg.inputs?.[key]) ? seg.inputs[key].length : 0;
    const dynamic = (seg.inputs?.resultRefs || []).filter((ref) => ref?.role === "identity").length;
    return staticCount + dynamic;
}

function selectedRunIds(state) {
    if (!state.runSelectEnabled) return new Set();
    return new Set((state.runSelection || []).map((index) => state.segments[index]?.id).filter(Boolean));
}

function restoreRunSelectionByIds(state, ids) {
    if (!state.runSelectEnabled) {
        state.runSelection = [];
        return;
    }
    state.runSelection = state.segments
        .map((seg, index) => ids.has(seg.id) ? index : -1)
        .filter((index) => index >= 0);
}

function canonicalRunSelection(state) {
    const count = state.segments.length;
    let selection = Array.isArray(state.runSelection)
        ? [...new Set(state.runSelection.map((v) => Number.parseInt(v, 10)).filter((v) => Number.isInteger(v) && v >= 0 && v < count))].sort((a, b) => a - b)
        : [];
    if (state.runSelectEnabled && selection.length === 0 && count > 0) selection = [...Array(count).keys()];
    state.runSelection = state.runSelectEnabled ? selection : [];
}

export function createDefaultMixedTimeline(editor) {
    const widgets = new Map((editor?.node?.widgets || []).map((widget) => [widget?.name, widget]));
    const fps = Number(widgets.get("frame_rate")?.value || editor?.timeline?.frameRate || 24) || 24;
    const width = Number(widgets.get("width")?.value || editor?.timeline?.output?.width || 864) || 864;
    const height = Number(widgets.get("height")?.value || editor?.timeline?.output?.height || 480) || 480;
    const refMax = Number(widgets.get("ref_max_size")?.value || editor?.timeline?.output?.longEdge || 864) || 864;
    return normalizeMixedTimeline({
        version: 1,
        timelineMode: "mixed",
        frameRate: fps,
        width,
        height,
        refMaxSize: refMax,
        output: {
            mode: "fixed",
            width,
            height,
            longEdge: refMax,
            exportMode: "all",
            maxExportFrames: 0,
            audioMode: "generate",
        },
        runSelectEnabled: false,
        runSelection: [],
        segments: [newMixedSegment({ idFactory: uid, duration: 5 })],
    }, { idFactory: uid });
}

export function parseOrCreateMixedTimeline(editor) {
    try {
        const parsed = JSON.parse(String(editor?.timelineWidget?.value || "{}"));
        if (String(parsed?.timelineMode || "").toLowerCase() === "mixed") {
            canonicalRunSelection(parsed);
            return normalizeMixedTimeline(parsed, { idFactory: uid });
        }
    } catch {
        // fall through
    }
    return createDefaultMixedTimeline(editor);
}

export function syncMixedGlobalsFromWidgets(editor, state) {
    const widgets = new Map((editor?.node?.widgets || []).map((widget) => [widget?.name, widget]));
    const fps = Number(widgets.get("frame_rate")?.value || state.frameRate || 24) || 24;
    const width = Number(widgets.get("width")?.value || state.output?.width || state.width || 864) || 864;
    const height = Number(widgets.get("height")?.value || state.output?.height || state.height || 480) || 480;
    const refMax = Number(widgets.get("ref_max_size")?.value || state.output?.longEdge || state.refMaxSize || 864) || 864;
    state.frameRate = fps;
    state.width = width;
    state.height = height;
    state.refMaxSize = refMax;
    state.output = state.output || {};
    state.output.mode = state.output.mode || "fixed";
    state.output.width = width;
    state.output.height = height;
    state.output.longEdge = refMax;
    state.output.exportMode = state.output.exportMode || "all";
    return state;
}

export function mountMixedUI({ host, editor, initialState, onChange }) {
    if (!host) throw new Error("Mixed UI host is required.");
    ensureStyles();

    let state = normalizeMixedTimeline(initialState || createDefaultMixedTimeline(editor), { idFactory: uid });
    canonicalRunSelection(state);
    let selectedIndex = Math.min(Math.max(0, Number(editor?.selectedIndex || 0)), state.segments.length - 1);
    let destroyed = false;

    const root = document.createElement("div");
    root.className = "mmx-mixed-root";
    root.style.position = "relative";
    host.replaceChildren(root);

    function notify({ render = true } = {}) {
        if (destroyed) return;
        state = normalizeMixedTimeline(syncMixedGlobalsFromWidgets(editor, state), { idFactory: uid });
        canonicalRunSelection(state);
        selectedIndex = Math.min(Math.max(0, selectedIndex), state.segments.length - 1);
        onChange?.(clone(state));
        if (render) draw();
    }

    function status(message, kind = "") {
        const el = root.querySelector(".mmx-mixed-status");
        if (!el) return;
        el.className = `mmx-mixed-status${kind ? ` ${kind}` : ""}`;
        el.textContent = message || "";
    }

    function selectedSegment() {
        return state.segments[selectedIndex] || state.segments[0];
    }

    function mutate(fn, options) {
        const runIds = selectedRunIds(state);
        fn?.(state);
        if (runIds.size) restoreRunSelectionByIds(state, runIds);
        notify(options);
    }

    async function uploadDescriptor(kind) {
        const accept = kind === "image" ? "image/*" : kind === "audio" ? "audio/*" : "video/*";
        const file = await chooseFile(accept);
        if (!file) return null;
        status(`正在上传 ${file.name}…`);
        const uploaded = await uploadInput(file, { onProgress: (ratio) => status(`正在上传 ${file.name}… ${Math.round(ratio * 100)}%`) });
        const path = relativePath(uploaded);
        if (!path) throw new Error("上传完成但没有返回 input 文件路径。");
        status(`${file.name} 已上传`, "ok");
        const base = { fileName: uploaded.name || file.name, subfolder: uploaded.subfolder || "", type: "input" };
        if (kind === "image") return { ...base, imageFile: path };
        if (kind === "audio") return { ...base, audioFile: path };
        return { ...base, videoFile: path };
    }

    async function libraryDescriptor(kind) {
        const item = await openLibraryPicker(kind);
        if (!item) return null;
        status(`正在准备素材库项目：${item.title || item.id}…`);
        const materialized = await materializeMaterial(item.id);
        const path = inputRelativePath(materialized);
        if (!path) throw new Error("素材库项目无法 materialize 到 ComfyUI input。");
        const base = { assetId: String(item.id), fileName: path.split("/").pop(), type: "input", title: item.title || item.original_name || item.id };
        status(`已选择素材：${base.title}`, "ok");
        if (kind === "image") return { ...base, imageFile: path };
        if (kind === "audio") return { ...base, audioFile: path };
        return { ...base, videoFile: path };
    }

    function openLibraryPicker(kind) {
        return new Promise(async (resolve) => {
            const layer = document.createElement("div");
            layer.className = "mmx-mixed-picker-layer";
            const box = document.createElement("div");
            box.className = "mmx-mixed-picker";
            const head = document.createElement("div");
            head.className = "mmx-mixed-picker-head";
            const title = document.createElement("strong");
            title.textContent = `素材库 · ${kind === "image" ? "图片" : kind === "audio" ? "音频" : "参考视频"}`;
            const cancel = document.createElement("button");
            cancel.className = "mmx-mixed-btn";
            cancel.textContent = "取消";
            head.append(title, cancel);
            const list = document.createElement("div");
            list.className = "mmx-mixed-picker-list";
            list.innerHTML = '<div class="mmx-mixed-picker-empty">正在读取素材库…</div>';
            box.append(head, list);
            layer.appendChild(box);
            root.appendChild(layer);
            const close = (value) => { layer.remove(); resolve(value || null); };
            cancel.onclick = () => close(null);
            layer.addEventListener("click", (event) => { if (event.target === layer) close(null); });
            try {
                const { items } = await listMaterialLibrary({ type: kind });
                list.replaceChildren();
                if (!items.length) {
                    const empty = document.createElement("div");
                    empty.className = "mmx-mixed-picker-empty";
                    empty.textContent = "这个分类还没有素材。";
                    list.appendChild(empty);
                }
                for (const item of items) {
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = "mmx-mixed-picker-item";
                    btn.innerHTML = `<strong></strong><small></small>`;
                    btn.querySelector("strong").textContent = item.title || item.original_name || item.id;
                    btn.querySelector("small").textContent = item.category || item.original_name || String(item.id);
                    btn.onclick = () => close(item);
                    list.appendChild(btn);
                }
            } catch (error) {
                list.innerHTML = `<div class="mmx-mixed-picker-empty"></div>`;
                list.firstElementChild.textContent = `素材库读取失败：${error?.message || error}`;
            }
        });
    }

    function addResultRef(seg, role, origin, sourceId = "") {
        seg.inputs = seg.inputs || {};
        seg.inputs.resultRefs = seg.inputs.resultRefs || [];
        if (role !== "identity") removeResultRefs(seg, role);
        const ref = { role, origin, frame: "last" };
        if (origin === "earlier") ref.segmentId = sourceId;
        seg.inputs.resultRefs.push(ref);
    }

    function renderSingleImageSlot(container, seg, { title, role, staticKey, slotKey }) {
        const block = document.createElement("div");
        block.className = "mmx-mixed-media-block";
        const heading = document.createElement("div");
        heading.className = "mmx-mixed-media-title";
        heading.innerHTML = `<strong></strong>`;
        heading.querySelector("strong").textContent = title;
        block.appendChild(heading);

        const dynamic = findResultRef(seg, role);
        const staticValue = seg.inputs?.[staticKey] || null;
        let origin = dynamic?.origin || (staticValue?.assetId ? "library" : "upload");
        if (!dynamic && !staticValue) origin = "upload";
        const row = document.createElement("div");
        row.className = "mmx-mixed-media-row";
        const originSelect = document.createElement("select");
        for (const value of legalOriginsForSlot(slotKey)) {
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = { upload: "Upload", library: "Material Library", previous: "Previous Segment", earlier: "Earlier Segment" }[value] || value;
            originSelect.appendChild(opt);
        }
        originSelect.value = origin;
        row.appendChild(originSelect);

        const detail = document.createElement("div");
        detail.className = "grow";
        row.appendChild(detail);

        const renderDetail = () => {
            detail.replaceChildren();
            const current = findResultRef(seg, role);
            if (originSelect.value === "upload" || originSelect.value === "library") {
                const label = document.createElement("span");
                label.className = "mmx-mixed-media-name";
                label.textContent = mediaName(seg.inputs?.[staticKey]);
                const choose = document.createElement("button");
                choose.className = "mmx-mixed-btn";
                choose.textContent = originSelect.value === "upload" ? "选择文件" : "从素材库选择";
                choose.onclick = async () => {
                    try {
                        const descriptor = originSelect.value === "upload"
                            ? await uploadDescriptor("image")
                            : await libraryDescriptor("image");
                        if (!descriptor) return;
                        mutate(() => { seg.inputs[staticKey] = descriptor; removeResultRefs(seg, role); });
                    } catch (error) { status(error?.message || String(error), "error"); }
                };
                detail.append(label, choose);
            } else {
                const source = document.createElement("select");
                if (originSelect.value === "previous") {
                    const opt = document.createElement("option");
                    opt.value = selectedIndex > 0 ? state.segments[selectedIndex - 1].id : "";
                    opt.textContent = selectedIndex > 0 ? `Segment ${selectedIndex}` : "无 Previous Segment";
                    source.appendChild(opt);
                    source.disabled = true;
                } else {
                    for (let i = 0; i < selectedIndex; i += 1) {
                        const opt = document.createElement("option");
                        opt.value = state.segments[i].id;
                        opt.textContent = `Segment ${i + 1} · ${MODE_LABELS[state.segments[i].mode]}`;
                        source.appendChild(opt);
                    }
                    source.value = current?.segmentId || source.options[0]?.value || "";
                    source.onchange = () => mutate(() => { if (current) current.segmentId = source.value; });
                }
                const frame = document.createElement("input");
                frame.type = "number";
                frame.min = "0";
                frame.placeholder = "last";
                frame.title = "留空 = Last Frame；填写 0-based frame index = 指定静帧";
                frame.value = current?.frame === "last" || current?.frame == null ? "" : String(current.frame);
                frame.onchange = () => mutate(() => {
                    const ref = findResultRef(seg, role);
                    if (ref) ref.frame = frame.value === "" ? "last" : Math.max(0, Number.parseInt(frame.value, 10) || 0);
                });
                detail.append(source, frame);
            }
        };

        originSelect.onchange = () => mutate(() => {
            delete seg.inputs[staticKey];
            removeResultRefs(seg, role);
            if (originSelect.value === "previous") {
                addResultRef(seg, role, "previous");
            } else if (originSelect.value === "earlier") {
                const sourceId = state.segments[Math.max(0, selectedIndex - 1)]?.id || "";
                if (sourceId) addResultRef(seg, role, "earlier", sourceId);
            }
        });
        block.appendChild(row);
        renderDetail();
        container.appendChild(block);
    }

    function renderIdentityBlock(container, seg) {
        const key = identityStaticKey(seg);
        seg.inputs[key] = Array.isArray(seg.inputs[key]) ? seg.inputs[key] : [];
        const block = document.createElement("div");
        block.className = "mmx-mixed-media-block";
        const head = document.createElement("div");
        head.className = "mmx-mixed-media-title";
        const title = document.createElement("strong");
        title.textContent = `Identity / Picture (${identityTotal(seg)}/9)`;
        head.appendChild(title);
        for (const [label, origin] of [["Upload", "upload"], ["Library", "library"], ["Previous", "previous"], ["Earlier", "earlier"]]) {
            const button = document.createElement("button");
            button.className = "mmx-mixed-btn";
            button.textContent = `+ ${label}`;
            button.disabled = identityTotal(seg) >= 9 || (origin === "previous" && selectedIndex <= 0) || (origin === "earlier" && selectedIndex <= 0);
            button.onclick = async () => {
                if (identityTotal(seg) >= 9) return;
                try {
                    if (origin === "upload" || origin === "library") {
                        const desc = origin === "upload" ? await uploadDescriptor("image") : await libraryDescriptor("image");
                        if (!desc) return;
                        mutate(() => { seg.inputs[key].push({ ...desc, index: seg.inputs[key].length }); });
                    } else if (origin === "previous") {
                        mutate(() => addResultRef(seg, "identity", "previous"));
                    } else {
                        mutate(() => addResultRef(seg, "identity", "earlier", state.segments[selectedIndex - 1]?.id || ""));
                    }
                } catch (error) { status(error?.message || String(error), "error"); }
            };
            head.appendChild(button);
        }
        block.appendChild(head);

        seg.inputs[key].forEach((item, itemIndex) => {
            const row = document.createElement("div");
            row.className = "mmx-mixed-media-row";
            row.innerHTML = `<span class="mmx-mixed-media-origin"></span><span class="mmx-mixed-media-name"></span>`;
            row.querySelector(".mmx-mixed-media-origin").textContent = item.assetId ? "Library" : "Upload";
            row.querySelector(".mmx-mixed-media-name").textContent = mediaName(item);
            const del = document.createElement("button");
            del.className = "mmx-mixed-btn danger";
            del.textContent = "×";
            del.onclick = () => mutate(() => { seg.inputs[key].splice(itemIndex, 1); seg.inputs[key] = setDescriptorIndex(seg.inputs[key]); });
            row.appendChild(del);
            block.appendChild(row);
        });

        (seg.inputs.resultRefs || []).filter((ref) => ref?.role === "identity").forEach((ref) => {
            const row = document.createElement("div");
            row.className = "mmx-mixed-media-row";
            const origin = document.createElement("span");
            origin.className = "mmx-mixed-media-origin";
            origin.textContent = ref.origin === "previous" ? "Previous" : "Earlier";
            const source = document.createElement("select");
            if (ref.origin === "previous") {
                const opt = document.createElement("option");
                opt.value = state.segments[selectedIndex - 1]?.id || "";
                opt.textContent = `Segment ${selectedIndex}`;
                source.appendChild(opt);
                source.disabled = true;
            } else {
                for (let i = 0; i < selectedIndex; i += 1) {
                    const opt = document.createElement("option");
                    opt.value = state.segments[i].id;
                    opt.textContent = `Segment ${i + 1}`;
                    source.appendChild(opt);
                }
                source.value = ref.segmentId || source.options[0]?.value || "";
                source.onchange = () => mutate(() => { ref.segmentId = source.value; });
            }
            const frame = document.createElement("input");
            frame.type = "number";
            frame.min = "0";
            frame.placeholder = "last";
            frame.value = ref.frame === "last" || ref.frame == null ? "" : String(ref.frame);
            frame.onchange = () => mutate(() => { ref.frame = frame.value === "" ? "last" : Math.max(0, Number.parseInt(frame.value, 10) || 0); });
            const del = document.createElement("button");
            del.className = "mmx-mixed-btn danger";
            del.textContent = "×";
            del.onclick = () => mutate(() => {
                const pos = seg.inputs.resultRefs.indexOf(ref);
                if (pos >= 0) seg.inputs.resultRefs.splice(pos, 1);
            });
            row.append(origin, source, frame, del);
            block.appendChild(row);
        });
        container.appendChild(block);
    }

    function renderReferenceList(container, seg, { title, key, kind, max = 3 }) {
        seg.inputs[key] = Array.isArray(seg.inputs[key]) ? seg.inputs[key] : [];
        const block = document.createElement("div");
        block.className = "mmx-mixed-media-block";
        const head = document.createElement("div");
        head.className = "mmx-mixed-media-title";
        const titleEl = document.createElement("strong");
        titleEl.textContent = `${title} (${seg.inputs[key].length}/${max})`;
        head.appendChild(titleEl);
        for (const [label, source] of [["Upload", "upload"], ["Library", "library"]]) {
            const button = document.createElement("button");
            button.className = "mmx-mixed-btn";
            button.textContent = `+ ${label}`;
            button.disabled = seg.inputs[key].length >= max;
            button.onclick = async () => {
                try {
                    const desc = source === "upload" ? await uploadDescriptor(kind) : await libraryDescriptor(kind);
                    if (!desc) return;
                    mutate(() => {
                        seg.inputs[key].push({ ...desc, index: seg.inputs[key].length });
                        seg.inputs[key] = setDescriptorIndex(seg.inputs[key]);
                    });
                } catch (error) { status(error?.message || String(error), "error"); }
            };
            head.appendChild(button);
        }
        block.appendChild(head);
        seg.inputs[key].forEach((item, index) => {
            const row = document.createElement("div");
            row.className = "mmx-mixed-media-row";
            const tag = document.createElement("span");
            tag.className = "mmx-mixed-media-origin";
            tag.textContent = kind === "video" ? `<Video ${index + 1}>` : `<Audio ${index + 1}>`;
            const name = document.createElement("span");
            name.className = "mmx-mixed-media-name";
            name.textContent = mediaName(item);
            const del = document.createElement("button");
            del.className = "mmx-mixed-btn danger";
            del.textContent = "×";
            del.onclick = () => mutate(() => { seg.inputs[key].splice(index, 1); seg.inputs[key] = setDescriptorIndex(seg.inputs[key]); });
            row.append(tag, name, del);
            block.appendChild(row);
        });
        container.appendChild(block);
    }

    function renderSourceVideo(container, seg) {
        const source = seg.inputs.sourceVideo || null;
        const block = document.createElement("div");
        block.className = "mmx-mixed-media-block";
        const head = document.createElement("div");
        head.className = "mmx-mixed-media-title";
        const title = document.createElement("strong");
        title.textContent = "Source Video";
        const upload = document.createElement("button");
        upload.className = "mmx-mixed-btn primary";
        upload.textContent = source ? "替换 Source Video" : "上传 Source Video";
        upload.onclick = async () => {
            try {
                const descriptor = await uploadDescriptor("video");
                if (!descriptor) return;
                const info = await probeVideo(descriptor.videoFile);
                const duration = Number(info.duration) > 0
                    ? Number(info.duration)
                    : (Number(info.frame_count) / (Number(info.native_fps) || Number(state.frameRate) || 24));
                mutate(() => {
                    seg.inputs.sourceVideo = {
                        ...descriptor,
                        duration: Math.max(0, duration || 0),
                        nativeFps: Number(info.native_fps) || 0,
                        sourceFrameCount: Number(info.frame_count) || 0,
                        storageWidth: Number(info.width) || undefined,
                        storageHeight: Number(info.height) || undefined,
                        range: { startSec: 0, endSec: Math.max(0.04, duration || 0.04) },
                    };
                });
            } catch (error) { status(error?.message || String(error), "error"); }
        };
        head.append(title, upload);
        block.appendChild(head);
        const preview = document.createElement("div");
        preview.className = "mmx-mixed-source-preview";
        if (source?.videoFile) {
            const video = document.createElement("video");
            video.src = viewUrl(source);
            video.controls = true;
            video.preload = "metadata";
            preview.appendChild(video);
        } else {
            const empty = document.createElement("div");
            empty.className = "mmx-mixed-source-empty";
            empty.textContent = "Source Video 必填；素材库视频不会出现在这里。";
            preview.appendChild(empty);
        }
        block.appendChild(preview);
        if (source) {
            const range = document.createElement("div");
            range.className = "mmx-mixed-range";
            const make = (labelText, key) => {
                const label = document.createElement("label");
                label.textContent = labelText;
                const input = document.createElement("input");
                input.type = "number";
                input.min = "0";
                input.step = "0.01";
                input.value = Number(source.range?.[key] || 0).toFixed(2);
                input.onchange = () => mutate(() => {
                    const next = Number(input.value) || 0;
                    seg.inputs.sourceVideo.range = seg.inputs.sourceVideo.range || { startSec: 0, endSec: 0.04 };
                    seg.inputs.sourceVideo.range[key] = Math.max(0, next);
                    if (key === "startSec" && seg.inputs.sourceVideo.range.endSec <= next) seg.inputs.sourceVideo.range.endSec = next + 0.04;
                    if (key === "endSec" && next <= seg.inputs.sourceVideo.range.startSec) seg.inputs.sourceVideo.range.endSec = seg.inputs.sourceVideo.range.startSec + 0.04;
                    const max = Number(seg.inputs.sourceVideo.duration) || 0;
                    if (max > 0) seg.inputs.sourceVideo.range.endSec = Math.min(seg.inputs.sourceVideo.range.endSec, max);
                });
                label.appendChild(input);
                return label;
            };
            range.append(make("Start (s)", "startSec"), make("End (s)", "endSec"));
            const duration = document.createElement("div");
            duration.className = "mmx-mixed-help";
            duration.textContent = `Segment ${(Math.max(0, Number(source.range?.endSec || 0) - Number(source.range?.startSec || 0))).toFixed(2)}s`;
            range.appendChild(duration);
            block.appendChild(range);
        }
        container.appendChild(block);
    }

    function renderModeInputs(container, seg) {
        if (seg.mode === "i2v") {
            renderSingleImageSlot(container, seg, { title: "Start Frame", role: "i2v_start", staticKey: "startFrame", slotKey: "i2v_start" });
        } else if (seg.mode === "fl2v") {
            renderSingleImageSlot(container, seg, { title: "First Frame", role: "fl2v_first", staticKey: "firstFrame", slotKey: "fl2v_first" });
            renderSingleImageSlot(container, seg, { title: "Last Frame", role: "fl2v_last", staticKey: "lastFrame", slotKey: "fl2v_last" });
        } else if (seg.mode === "r2v") {
            renderIdentityBlock(container, seg);
            renderReferenceList(container, seg, { title: "Reference Video", key: "referenceVideos", kind: "video", max: 3 });
            renderReferenceList(container, seg, { title: "Reference Audio", key: "referenceAudios", kind: "audio", max: 3 });
        } else if (seg.mode === "source_video") {
            renderSourceVideo(container, seg);
            renderIdentityBlock(container, seg);
            renderReferenceList(container, seg, { title: "Reference Audio", key: "referenceAudios", kind: "audio", max: 3 });
            const note = document.createElement("div");
            note.className = "mmx-mixed-help";
            note.textContent = "Source Video 只接受当前 Segment 上传的视频；Material Library 的视频只属于 R2V Reference Video。";
            container.appendChild(note);
        }
    }

    function renderTimeline(panel) {
        const wrap = document.createElement("div");
        wrap.className = "mmx-mixed-timeline";
        const head = document.createElement("div");
        head.className = "mmx-mixed-panel-head";
        const title = document.createElement("strong");
        title.textContent = `Mixed Timeline · ${state.segments.length} Segment(s)`;
        const spacer = document.createElement("span");
        spacer.className = "spacer";
        const runLabel = document.createElement("label");
        runLabel.className = "mmx-mixed-inline";
        const runToggle = document.createElement("input");
        runToggle.type = "checkbox";
        runToggle.checked = !!state.runSelectEnabled;
        runToggle.onchange = () => mutate(() => {
            state.runSelectEnabled = runToggle.checked;
            state.runSelection = runToggle.checked ? [...Array(state.segments.length).keys()] : [];
        });
        runLabel.append(runToggle, document.createTextNode("选择运行"));
        const add = document.createElement("button");
        add.className = "mmx-mixed-btn primary";
        add.textContent = "+ Segment";
        add.onclick = () => mutate(() => {
            state.segments.push(newMixedSegment({ idFactory: uid, duration: 5 }));
            selectedIndex = state.segments.length - 1;
            if (state.runSelectEnabled) state.runSelection.push(selectedIndex);
        });
        head.append(title, spacer, runLabel, add);
        wrap.appendChild(head);

        const invalidIds = new Set(validateMixedReferences(state.segments).map((e) => e.consumerId));
        const cards = document.createElement("div");
        cards.className = "mmx-mixed-cards";
        state.segments.forEach((seg, index) => {
            const card = document.createElement("div");
            card.className = `mmx-mixed-card${index === selectedIndex ? " selected" : ""}${invalidIds.has(seg.id) ? " invalid" : ""}`;
            card.onclick = (event) => {
                if (event.target.closest("button,input")) return;
                selectedIndex = index;
                editor.selectedIndex = index;
                draw();
            };
            if (state.runSelectEnabled) {
                const runbox = document.createElement("label");
                runbox.className = "mmx-mixed-runbox";
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.checked = state.runSelection.includes(index);
                checkbox.onchange = () => mutate(() => {
                    const set = new Set(state.runSelection);
                    if (checkbox.checked) set.add(index); else set.delete(index);
                    state.runSelection = [...set].sort((a, b) => a - b);
                });
                runbox.appendChild(checkbox);
                card.appendChild(runbox);
            }
            const top = document.createElement("div");
            top.className = "mmx-mixed-card-top";
            const idx = document.createElement("span");
            idx.className = "mmx-mixed-card-index";
            idx.textContent = `S${String(index + 1).padStart(2, "0")}`;
            const badge = document.createElement("span");
            badge.className = "mmx-mixed-mode-badge";
            badge.textContent = MODE_LABELS[seg.mode];
            const backend = document.createElement("span");
            backend.className = "mmx-mixed-backend";
            backend.textContent = seg.backendTask || backendTaskPreview(seg.mode, identityTotal(seg));
            top.append(idx, badge, backend);
            const prompt = document.createElement("div");
            prompt.className = "mmx-mixed-card-prompt";
            prompt.textContent = seg.prompt || "(no prompt)";
            const meta = document.createElement("div");
            meta.className = "mmx-mixed-card-meta";
            if (seg.mode === "source_video") {
                const r = seg.inputs?.sourceVideo?.range || {};
                meta.textContent = `${Math.max(0, Number(r.endSec || 0) - Number(r.startSec || 0)).toFixed(2)}s · ${seg.id}`;
            } else {
                meta.textContent = `${Number(seg.duration || 0).toFixed(2)}s · ${seg.id}`;
            }
            const actions = document.createElement("div");
            actions.className = "mmx-mixed-card-actions";
            const up = document.createElement("button"); up.className = "mmx-mixed-btn"; up.textContent = "↑"; up.disabled = index === 0;
            const down = document.createElement("button"); down.className = "mmx-mixed-btn"; down.textContent = "↓"; down.disabled = index === state.segments.length - 1;
            const dup = document.createElement("button"); dup.className = "mmx-mixed-btn"; dup.textContent = "复制";
            const del = document.createElement("button"); del.className = "mmx-mixed-btn danger"; del.textContent = "删除"; del.disabled = state.segments.length <= 1;
            up.onclick = () => mutate(() => { state.segments = moveMixedSegment(state.segments, index, index - 1); selectedIndex = index - 1; });
            down.onclick = () => mutate(() => { state.segments = moveMixedSegment(state.segments, index, index + 1); selectedIndex = index + 1; });
            dup.onclick = () => mutate(() => { state.segments = duplicateMixedSegment(state.segments, index, { idFactory: uid }); selectedIndex = index + 1; });
            del.onclick = () => {
                const deps = referencedDependents(state.segments, seg.id);
                const message = deps.length
                    ? `这个 Segment 被 ${deps.length} 个 Earlier Segment 引用。删除后这些引用会变成 Missing Reference。仍要删除？`
                    : `删除 Segment ${index + 1}？`;
                if (!window.confirm(message)) return;
                mutate(() => {
                    state.segments.splice(index, 1);
                    selectedIndex = Math.min(index, state.segments.length - 1);
                });
            };
            actions.append(up, down, dup, del);
            card.append(top, prompt, meta, actions);
            cards.appendChild(card);
        });
        wrap.appendChild(cards);
        panel.appendChild(wrap);
    }

    function renderEditor(panel) {
        const wrap = document.createElement("div");
        wrap.className = "mmx-mixed-editor-wrap";
        const editorPanel = document.createElement("div");
        editorPanel.className = "mmx-mixed-editor";
        const seg = selectedSegment();

        const modeField = document.createElement("div");
        modeField.className = "mmx-mixed-field";
        const modeLabel = document.createElement("label");
        modeLabel.textContent = "Mode";
        const mode = document.createElement("select");
        for (const value of MIXED_SEGMENT_MODES) {
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = MODE_LABELS[value];
            mode.appendChild(opt);
        }
        mode.value = seg.mode;
        mode.onchange = () => mutate(() => {
            seg.mode = mode.value;
            seg.inputs = { resultRefs: [], identityPictures: [] };
            seg.backendTask = backendTaskPreview(seg.mode, 0);
            if (seg.mode === "source_video") seg.duration = 0;
        });
        modeField.append(modeLabel, mode);
        editorPanel.appendChild(modeField);

        const promptField = document.createElement("div");
        promptField.className = "mmx-mixed-field";
        const promptLabel = document.createElement("label"); promptLabel.textContent = "Prompt";
        const prompt = document.createElement("textarea");
        prompt.value = seg.prompt || "";
        prompt.oninput = () => {
            seg.prompt = prompt.value;
            onChange?.(clone(state));
            const cardPrompt = root.querySelectorAll(".mmx-mixed-card-prompt")[selectedIndex];
            if (cardPrompt) cardPrompt.textContent = seg.prompt || "(no prompt)";
        };
        prompt.onchange = () => notify();
        promptField.append(promptLabel, prompt);
        editorPanel.appendChild(promptField);

        if (seg.mode !== "source_video") {
            const durationField = document.createElement("div");
            durationField.className = "mmx-mixed-field";
            const label = document.createElement("label"); label.textContent = "Duration (seconds)";
            const duration = document.createElement("input");
            duration.type = "number"; duration.min = "0.1"; duration.step = "0.1"; duration.value = String(seg.duration || 5);
            duration.onchange = () => mutate(() => { seg.duration = Math.max(0.1, Number(duration.value) || 5); });
            durationField.append(label, duration);
            editorPanel.appendChild(durationField);
        }
        renderModeInputs(editorPanel, seg);

        const continuity = document.createElement("div");
        continuity.className = "mmx-mixed-continuity";
        const h = document.createElement("h3"); h.textContent = "Continuity · Previous Segment";
        continuity.appendChild(h);
        if (selectedIndex === 0) {
            const note = document.createElement("div");
            note.className = "mmx-mixed-help";
            note.textContent = "Root Segment 没有 Previous Segment。";
            continuity.appendChild(note);
        } else {
            for (const [key, labelText] of [["visual", "Visual MC"], ["audio", "Audio Context"]]) {
                const label = document.createElement("label");
                label.className = "mmx-mixed-toggle";
                const input = document.createElement("input");
                input.type = "checkbox";
                input.checked = !!seg.continuity?.[key];
                input.onchange = () => mutate(() => { seg.continuity[key] = input.checked; });
                const text = document.createElement("span");
                text.textContent = labelText;
                label.append(input, text);
                continuity.appendChild(label);
            }
        }
        const dep = document.createElement("div");
        dep.className = "mmx-mixed-deps";
        dep.textContent = "Identity/Keyframe result refs 与 MC 独立；Previous 是动态相邻关系，Earlier 使用稳定 Segment ID。";
        continuity.appendChild(dep);
        const errors = validateMixedReferences(state.segments).filter((error) => error.consumerId === seg.id);
        for (const error of errors) {
            const e = document.createElement("div");
            e.className = "mmx-mixed-error";
            e.textContent = `${error.code}: ${error.message}`;
            continuity.appendChild(e);
        }
        wrap.append(editorPanel, continuity);
        panel.appendChild(wrap);
    }

    function renderGlobal(container) {
        const bar = document.createElement("div");
        bar.className = "mmx-mixed-global";
        const title = document.createElement("strong");
        title.textContent = "Mixed Mode";
        const values = [
            ["FPS", "frameRate", 1, 240, 0.01],
            ["Width", "width", 32, 8192, 32],
            ["Height", "height", 32, 8192, 32],
        ];
        bar.appendChild(title);
        for (const [labelText, key, min, max, step] of values) {
            const label = document.createElement("label");
            label.appendChild(document.createTextNode(labelText));
            const input = document.createElement("input");
            input.type = "number"; input.min = String(min); input.max = String(max); input.step = String(step);
            input.value = String(key === "frameRate" ? state.frameRate : state.output?.[key] || state[key]);
            input.onchange = () => mutate(() => {
                const value = Math.max(min, Math.min(max, Number(input.value) || min));
                if (key === "frameRate") state.frameRate = value;
                else { state[key] = value; state.output = state.output || {}; state.output[key] = value; }
            });
            label.appendChild(input);
            bar.appendChild(label);
        }
        const exportLabel = document.createElement("label");
        exportLabel.appendChild(document.createTextNode("Export"));
        const exportSelect = document.createElement("select");
        for (const value of ["all", "segments"]) {
            const opt = document.createElement("option"); opt.value = value; opt.textContent = value === "all" ? "Final (All)" : "Segments"; exportSelect.appendChild(opt);
        }
        exportSelect.value = state.output?.exportMode || "all";
        exportSelect.onchange = () => mutate(() => { state.output.exportMode = exportSelect.value; });
        exportLabel.appendChild(exportSelect);
        bar.appendChild(exportLabel);
        container.appendChild(bar);
    }

    function draw() {
        if (destroyed) return;
        root.replaceChildren();
        renderGlobal(root);
        const timelinePanel = document.createElement("div"); timelinePanel.className = "mmx-mixed-panel";
        renderTimeline(timelinePanel);
        root.appendChild(timelinePanel);
        const editorPanel = document.createElement("div"); editorPanel.className = "mmx-mixed-panel";
        renderEditor(editorPanel);
        root.appendChild(editorPanel);
        const stat = document.createElement("div"); stat.className = "mmx-mixed-status";
        const errors = validateMixedReferences(state.segments);
        stat.classList.toggle("error", errors.length > 0);
        stat.textContent = errors.length ? `${errors.length} 个引用需要修正。` : "Mixed schema valid.";
        root.appendChild(stat);
    }

    draw();
    onChange?.(clone(state));

    return {
        root,
        get state() { return clone(state); },
        setState(next) { state = normalizeMixedTimeline(next, { idFactory: uid }); canonicalRunSelection(state); draw(); },
        syncGlobals() { syncMixedGlobalsFromWidgets(editor, state); onChange?.(clone(state)); },
        destroy({ restoreHost = false } = {}) {
            destroyed = true;
            if (!restoreHost && root.isConnected) root.remove();
        },
    };
}
