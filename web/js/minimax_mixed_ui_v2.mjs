import { api } from "../../scripts/api.js";
import {
    MIXED_SEGMENT_MODES,
    backendTaskPreview,
    duplicateMixedSegment,
    moveMixedSegment,
    newMixedSegment,
    normalizeMixedTimeline,
    referencedDependents,
    validateMixedReferences,
} from "./minimax_mixed_state.mjs?boot=mixed_native_v5";
import { inputRelativePath, materializeMaterial } from "./minimax_material_library_api.mjs";
import { pickMixedMaterial } from "./minimax_mixed_material_picker.mjs";
import { mt, onMixedLocaleChange } from "./minimax_mixed_i18n.mjs";
import { renderMixedNativeModeCard } from "./minimax_mixed_native_inputs.mjs?boot=mixed_native_v5";

const STYLE_ID = "mmx-mixed-mode-integrated-styles";
const CHUNK_BYTES = 8 * 1024 * 1024;
const CHUNK_THRESHOLD = 80 * 1024 * 1024;

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    // Only layout that has no equivalent in the existing Director is defined
    // here. Buttons, fields, panels, labels and prompt styling use .bd-*.
    style.textContent = `
.mmx-mixed-root{min-height:0;display:flex;flex-direction:column;gap:8px;padding:0;box-sizing:border-box;font-family:inherit;color:inherit}
.mmx-mixed-timeline-panel{flex:0 0 auto;min-height:0;overflow:hidden}.mmx-mixed-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mmx-mixed-toolbar .mmx-spacer{flex:1}
.mmx-mixed-cards{display:flex;gap:7px;overflow-x:auto;overflow-y:hidden;min-height:0;padding:2px;align-items:stretch}.mmx-mixed-card{flex:1 0 190px;min-width:190px;min-height:112px;cursor:pointer;position:relative}.mmx-mixed-card.selected{outline:1px solid #4fff8f}.mmx-mixed-card.invalid{outline:1px solid #e46d6d}.mmx-mixed-card-head{display:flex;align-items:center;gap:6px}.mmx-mixed-card-head b{white-space:nowrap}.mmx-mixed-card-prompt{min-height:34px;max-height:38px;overflow:hidden;white-space:pre-wrap}.mmx-mixed-card-actions{display:flex;gap:4px;flex-wrap:wrap;margin-top:auto}.mmx-mixed-card-actions .bd-btn{padding:3px 6px;font-size:10px}
.mmx-mixed-editor-grid{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:8px}.mmx-mixed-editor-panel{min-height:0;overflow:visible}.mmx-mixed-continuity-panel{min-height:28px;display:flex;align-items:center;justify-content:center;gap:8px;padding:4px 8px!important;overflow:visible}.mmx-mixed-continuity-panel>b{font-size:11px;color:#999;font-weight:500}.mmx-mixed-continuity-panel .mmx-mixed-toggle{border:1px solid #444;border-radius:999px;padding:5px 9px;background:#171717}.mmx-mixed-field{display:flex;flex-direction:column;gap:4px}.mmx-mixed-field-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.mmx-mixed-field-row>.grow{flex:1 1 180px;min-width:120px}.mmx-mixed-field input[type=number],.mmx-mixed-field input[type=text]{background:#181818;border:1px solid #333;border-radius:4px;color:#eee;padding:5px 7px;box-sizing:border-box}.mmx-mixed-field input[type=text]{width:100%}.mmx-mixed-media-block{display:flex;flex-direction:column;gap:6px;padding-top:7px;border-top:1px solid #333}.mmx-mixed-media-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.mmx-mixed-media-head b{margin-right:auto}.mmx-mixed-media-row{display:flex;align-items:center;gap:6px;min-width:0}.mmx-mixed-media-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mmx-mixed-media-row .bd-select{max-width:180px}.mmx-mixed-source-preview{height:150px;background:#111;border:1px solid #333;border-radius:6px;overflow:hidden;display:flex;align-items:center;justify-content:center}.mmx-mixed-source-preview video{width:100%;height:100%;object-fit:contain}.mmx-mixed-status{min-height:18px}.mmx-mixed-status.error{color:#ff9090}.mmx-mixed-status.ok{color:#72d99b}.mmx-mixed-warning{color:#f5b55f}.mmx-mixed-toggle{display:flex;align-items:center;gap:7px}.mmx-mixed-toggle input{accent-color:#4fff8f}.mmx-mixed-result-row,.mmx-mixed-native-result-row{display:grid;grid-template-columns:minmax(130px,1fr) 110px auto;gap:6px;align-items:center}.mmx-mixed-native-card{width:100%;box-sizing:border-box}.mmx-mixed-native-slot-actions,.mmx-mixed-native-section-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px}.mmx-mixed-native-slot-actions .mmx-mixed-native-result-row{flex:1 1 320px}.mmx-mixed-source-range{margin-top:8px}.mmx-mixed-source-range input{width:70px}.mmx-mixed-editor-panel>.bd-seg-head{margin-bottom:6px}
@media(max-width:768px){.mmx-mixed-card{flex-basis:165px;min-width:165px}.mmx-mixed-result-row,.mmx-mixed-native-result-row{grid-template-columns:1fr 90px auto}}
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

function setI18n(element, key, vars = {}) {
    element.dataset.mmxI18n = key;
    element.dataset.mmxI18nVars = JSON.stringify(vars || {});
    element.textContent = mt(key, vars);
    return element;
}

function refreshLocale(root) {
    for (const element of root.querySelectorAll?.("[data-mmx-i18n]") || []) {
        let vars = {};
        try { vars = JSON.parse(element.dataset.mmxI18nVars || "{}"); } catch { vars = {}; }
        element.textContent = mt(element.dataset.mmxI18n, vars);
    }
}

function modeLabel(mode) {
    return mt(`mixed.mode.${mode}`);
}

function mediaName(item) {
    return String(
        item?.title
        || item?.original_name
        || item?.imageFile
        || item?.videoFile
        || item?.audioFile
        || item?.fileName
        || item?.name
        || mt("mixed.none"),
    );
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

function descriptorBase(upload, fileName = "") {
    return {
        fileName: fileName || upload?.name || upload?.filename || "",
        type: upload?.type || "input",
        subfolder: upload?.subfolder || "",
    };
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
        output: {
            mode: "fixed",
            width,
            height,
            longEdge: refMax,
            exportMode: "all",
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
        // fall through to a fresh Mixed workspace
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
    let selectedIndex = 0;
    let destroyed = false;

    const root = document.createElement("div");
    root.className = "mmx-mixed-root";
    host.replaceChildren(root);

    function selectedSegment() {
        return state.segments[selectedIndex] || state.segments[0];
    }

    function status(message, kind = "") {
        const element = root.querySelector(".mmx-mixed-status");
        if (!element) return;
        element.className = `bd-meta mmx-mixed-status${kind ? ` ${kind}` : ""}`;
        element.textContent = message || "";
    }

    function notify({ render = true } = {}) {
        if (destroyed) return;
        state = normalizeMixedTimeline(syncMixedGlobalsFromWidgets(editor, state), { idFactory: uid });
        canonicalRunSelection(state);
        selectedIndex = Math.min(Math.max(0, selectedIndex), state.segments.length - 1);
        onChange?.(clone(state));
        if (render) draw();
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
        status(mt("mixed.uploading", { name: file.name }));
        const uploaded = await uploadInput(file, {
            onProgress: (ratio) => status(mt("mixed.uploadingProgress", {
                name: file.name,
                percent: Math.round(ratio * 100),
            })),
        });
        const path = relativePath(uploaded);
        if (!path) throw new Error("Uploaded file did not return a ComfyUI input path.");
        const base = descriptorBase(uploaded, file.name);
        if (kind === "image") return { ...base, imageFile: path };
        if (kind === "audio") return { ...base, audioFile: path };
        return { ...base, videoFile: path };
    }

    async function libraryDescriptor(kind) {
        const item = await pickMixedMaterial(editor, { type: kind });
        if (!item) return null;
        status(mt("mixed.preparingMaterial", { name: item.title || item.id }));
        const materialized = await materializeMaterial(item.id);
        const path = inputRelativePath(materialized);
        if (!path) throw new Error("Material Library item could not be materialized to ComfyUI input.");
        const base = {
            assetId: item.id,
            fileName: item.original_name || item.title || item.id,
            type: "input",
            subfolder: materialized?.subfolder || "",
        };
        if (kind === "image") return { ...base, imageFile: path };
        if (kind === "audio") return { ...base, audioFile: path };
        return { ...base, videoFile: path };
    }

    function addResultRef(seg, role, sourceId) {
        seg.inputs = seg.inputs || {};
        seg.inputs.resultRefs = seg.inputs.resultRefs || [];
        if (role !== "identity") removeResultRefs(seg, role);
        seg.inputs.resultRefs.push({ role, origin: "segment", segmentId: sourceId, frame: "last" });
    }

    function appendActionButton(parent, key, action, handler, { primary = false, disabled = false } = {}) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `bd-btn${primary ? " bd-btn-primary" : ""}`;
        button.dataset.mmxAction = action;
        setI18n(button, key);
        button.disabled = disabled;
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            handler?.(event);
        });
        parent.appendChild(button);
        return button;
    }

    function segmentSelector(selectedId = "") {
        const select = document.createElement("select");
        select.className = "bd-select";
        for (let index = 0; index < selectedIndex; index += 1) {
            const option = document.createElement("option");
            option.value = state.segments[index].id;
            option.textContent = mt("mixed.segment", { n: index + 1 });
            select.appendChild(option);
        }
        if (selectedId) select.value = selectedId;
        return select;
    }

    function renderResultRefRow(container, seg, ref) {
        const row = document.createElement("div");
        row.className = "mmx-mixed-result-row";
        const source = segmentSelector(ref.segmentId || "");
        source.addEventListener("change", () => mutate(() => { ref.segmentId = source.value; }));
        const frame = document.createElement("input");
        frame.type = "text";
        frame.value = String(ref.frame ?? "last");
        frame.title = mt("mixed.frameLast");
        frame.addEventListener("change", () => mutate(() => {
            const raw = String(frame.value || "last").trim().toLowerCase();
            ref.frame = raw === "last" ? "last" : Math.max(0, Number.parseInt(raw, 10) || 0);
        }));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "bd-btn";
        setI18n(remove, "mixed.remove");
        remove.onclick = () => mutate(() => {
            seg.inputs.resultRefs = (seg.inputs.resultRefs || []).filter((item) => item !== ref);
        });
        row.append(source, frame, remove);
        container.appendChild(row);
    }

    function renderSingleImageSlot(container, seg, { titleKey, role, staticKey }) {
        const block = document.createElement("div");
        block.className = "mmx-mixed-media-block";
        const head = document.createElement("div");
        head.className = "mmx-mixed-media-head";
        const title = document.createElement("b");
        setI18n(title, titleKey);
        head.appendChild(title);
        appendActionButton(head, "mixed.upload", `upload-${role}`, async () => {
            try {
                const descriptor = await uploadDescriptor("image");
                if (!descriptor) return;
                mutate(() => {
                    seg.inputs[staticKey] = descriptor;
                    removeResultRefs(seg, role);
                });
                status(mt("mixed.ready"), "ok");
            } catch (error) { status(mt("mixed.error", { message: error?.message || error }), "error"); }
        });
        appendActionButton(head, "mixed.library", `library-${role}`, async () => {
            try {
                const descriptor = await libraryDescriptor("image");
                if (!descriptor) return;
                mutate(() => {
                    seg.inputs[staticKey] = descriptor;
                    removeResultRefs(seg, role);
                });
                status(mt("mixed.ready"), "ok");
            } catch (error) { status(mt("mixed.error", { message: error?.message || error }), "error"); }
        });
        appendActionButton(head, "mixed.segmentResult", `segment-${role}`, () => {
            if (selectedIndex <= 0) return;
            mutate(() => {
                delete seg.inputs[staticKey];
                addResultRef(seg, role, state.segments[selectedIndex - 1].id);
            });
        }, { disabled: selectedIndex <= 0 });
        block.appendChild(head);

        const staticItem = seg.inputs?.[staticKey];
        if (staticItem) {
            const row = document.createElement("div");
            row.className = "mmx-mixed-media-row";
            const name = document.createElement("span");
            name.className = "bd-meta mmx-mixed-media-name";
            name.textContent = mediaName(staticItem);
            const remove = document.createElement("button");
            remove.className = "bd-btn";
            setI18n(remove, "mixed.remove");
            remove.onclick = () => mutate(() => { delete seg.inputs[staticKey]; });
            row.append(name, remove);
            block.appendChild(row);
        }
        const ref = findResultRef(seg, role);
        if (ref) renderResultRefRow(block, seg, ref);
        container.appendChild(block);
    }

    function renderIdentityBlock(container, seg) {
        const key = identityStaticKey(seg);
        seg.inputs[key] = Array.isArray(seg.inputs[key]) ? seg.inputs[key] : [];
        const block = document.createElement("div");
        block.className = "mmx-mixed-media-block";
        const head = document.createElement("div");
        head.className = "mmx-mixed-media-head";
        const title = document.createElement("b");
        title.dataset.mmxI18n = "mixed.identity";
        title.textContent = `${mt("mixed.identity")} (${identityTotal(seg)}/9)`;
        head.appendChild(title);
        appendActionButton(head, "mixed.upload", "upload-image", async () => {
            if (identityTotal(seg) >= 9) return;
            try {
                const descriptor = await uploadDescriptor("image");
                if (!descriptor) return;
                mutate(() => { seg.inputs[key] = setDescriptorIndex([...(seg.inputs[key] || []), descriptor]); });
                status(mt("mixed.ready"), "ok");
            } catch (error) { status(mt("mixed.error", { message: error?.message || error }), "error"); }
        }, { disabled: identityTotal(seg) >= 9 });
        appendActionButton(head, "mixed.library", "library-image", async () => {
            if (identityTotal(seg) >= 9) return;
            try {
                const descriptor = await libraryDescriptor("image");
                if (!descriptor) return;
                mutate(() => { seg.inputs[key] = setDescriptorIndex([...(seg.inputs[key] || []), descriptor]); });
                status(mt("mixed.ready"), "ok");
            } catch (error) { status(mt("mixed.error", { message: error?.message || error }), "error"); }
        }, { disabled: identityTotal(seg) >= 9 });
        appendActionButton(head, "mixed.segmentResult", "segment-image", () => {
            if (identityTotal(seg) >= 9 || selectedIndex <= 0) return;
            mutate(() => addResultRef(seg, "identity", state.segments[selectedIndex - 1].id));
        }, { disabled: identityTotal(seg) >= 9 || selectedIndex <= 0 });
        block.appendChild(head);

        for (const [index, item] of (seg.inputs[key] || []).entries()) {
            const row = document.createElement("div");
            row.className = "mmx-mixed-media-row";
            const name = document.createElement("span");
            name.className = "bd-meta mmx-mixed-media-name";
            name.textContent = `${index + 1}. ${mediaName(item)}`;
            const remove = document.createElement("button");
            remove.className = "bd-btn";
            setI18n(remove, "mixed.remove");
            remove.onclick = () => mutate(() => {
                seg.inputs[key] = setDescriptorIndex(seg.inputs[key].filter((_value, idx) => idx !== index));
            });
            row.append(name, remove);
            block.appendChild(row);
        }
        for (const ref of (seg.inputs.resultRefs || []).filter((item) => item?.role === "identity")) {
            renderResultRefRow(block, seg, ref);
        }
        container.appendChild(block);
    }

    function renderReferenceList(container, seg, { titleKey, key, kind, max = 3 }) {
        seg.inputs[key] = Array.isArray(seg.inputs[key]) ? seg.inputs[key] : [];
        const block = document.createElement("div");
        block.className = "mmx-mixed-media-block";
        const head = document.createElement("div");
        head.className = "mmx-mixed-media-head";
        const title = document.createElement("b");
        setI18n(title, titleKey);
        head.appendChild(title);
        appendActionButton(head, "mixed.upload", `upload-${kind}`, async () => {
            if (seg.inputs[key].length >= max) return;
            try {
                const descriptor = await uploadDescriptor(kind);
                if (!descriptor) return;
                mutate(() => { seg.inputs[key] = setDescriptorIndex([...(seg.inputs[key] || []), descriptor]); });
                status(mt("mixed.ready"), "ok");
            } catch (error) { status(mt("mixed.error", { message: error?.message || error }), "error"); }
        }, { disabled: seg.inputs[key].length >= max });
        appendActionButton(head, "mixed.library", `library-${kind}`, async () => {
            if (seg.inputs[key].length >= max) return;
            try {
                const descriptor = await libraryDescriptor(kind);
                if (!descriptor) return;
                mutate(() => { seg.inputs[key] = setDescriptorIndex([...(seg.inputs[key] || []), descriptor]); });
                status(mt("mixed.ready"), "ok");
            } catch (error) { status(mt("mixed.error", { message: error?.message || error }), "error"); }
        }, { disabled: seg.inputs[key].length >= max });
        block.appendChild(head);
        for (const [index, item] of seg.inputs[key].entries()) {
            const row = document.createElement("div");
            row.className = "mmx-mixed-media-row";
            const name = document.createElement("span");
            name.className = "bd-meta mmx-mixed-media-name";
            name.textContent = `${index + 1}. ${mediaName(item)}`;
            const remove = document.createElement("button");
            remove.className = "bd-btn";
            setI18n(remove, "mixed.remove");
            remove.onclick = () => mutate(() => {
                seg.inputs[key] = setDescriptorIndex(seg.inputs[key].filter((_value, idx) => idx !== index));
            });
            row.append(name, remove);
            block.appendChild(row);
        }
        container.appendChild(block);
    }

    function renderSourceVideo(container, seg) {
        const source = seg.inputs.sourceVideo || null;
        const block = document.createElement("div");
        block.className = "mmx-mixed-media-block";
        const head = document.createElement("div");
        head.className = "mmx-mixed-media-head";
        const title = document.createElement("b");
        setI18n(title, "mixed.sourceVideo");
        head.appendChild(title);
        appendActionButton(head, "mixed.uploadSourceVideo", "upload-source-video", async () => {
            try {
                const descriptor = await uploadDescriptor("video");
                if (!descriptor) return;
                const info = await probeVideo(descriptor.videoFile).catch(() => ({}));
                const duration = Math.max(0.1, Number(info?.duration_sec || info?.duration || 5) || 5);
                descriptor.range = { startSec: 0, endSec: duration };
                descriptor.durationSec = duration;
                mutate(() => { seg.inputs.sourceVideo = descriptor; });
                status(mt("mixed.ready"), "ok");
            } catch (error) { status(mt("mixed.error", { message: error?.message || error }), "error"); }
        }, { primary: true });
        block.appendChild(head);
        const hint = document.createElement("div");
        hint.className = "bd-meta";
        setI18n(hint, "mixed.sourceHint");
        block.appendChild(hint);
        if (source) {
            const name = document.createElement("div");
            name.className = "bd-meta";
            name.textContent = mediaName(source);
            block.appendChild(name);
            const url = viewUrl(source);
            if (url) {
                const preview = document.createElement("div");
                preview.className = "mmx-mixed-source-preview";
                const video = document.createElement("video");
                video.src = url;
                video.controls = true;
                video.preload = "metadata";
                preview.appendChild(video);
                block.appendChild(preview);
            }
            const row = document.createElement("div");
            row.className = "mmx-mixed-field-row";
            const startLabel = document.createElement("label");
            startLabel.className = "bd-label";
            setI18n(startLabel, "mixed.sourceStart");
            const start = document.createElement("input");
            start.type = "number";
            start.min = "0";
            start.step = "0.01";
            start.value = String(source.range?.startSec ?? 0);
            const endLabel = document.createElement("label");
            endLabel.className = "bd-label";
            setI18n(endLabel, "mixed.sourceEnd");
            const end = document.createElement("input");
            end.type = "number";
            end.min = "0.01";
            end.step = "0.01";
            end.value = String(source.range?.endSec ?? source.durationSec ?? 5);
            const updateRange = () => mutate(() => {
                const startSec = Math.max(0, Number(start.value) || 0);
                const endSec = Math.max(startSec + 0.01, Number(end.value) || startSec + 0.01);
                seg.inputs.sourceVideo.range = { startSec, endSec };
            });
            start.onchange = updateRange;
            end.onchange = updateRange;
            row.append(startLabel, start, endLabel, end);
            block.appendChild(row);
        }
        container.appendChild(block);
    }

    function renderModeInputs(container, seg) {
        if (seg.mode === "i2v") {
            renderSingleImageSlot(container, seg, {
                titleKey: "mixed.startFrame",
                role: "i2v_start",
                staticKey: "startFrame",
            });
        } else if (seg.mode === "fl2v") {
            renderSingleImageSlot(container, seg, {
                titleKey: "mixed.firstFrame",
                role: "fl2v_first",
                staticKey: "firstFrame",
            });
            renderSingleImageSlot(container, seg, {
                titleKey: "mixed.lastFrame",
                role: "fl2v_last",
                staticKey: "lastFrame",
            });
        } else if (seg.mode === "r2v") {
            renderIdentityBlock(container, seg);
            renderReferenceList(container, seg, {
                titleKey: "mixed.referenceVideo",
                key: "referenceVideos",
                kind: "video",
                max: 3,
            });
            renderReferenceList(container, seg, {
                titleKey: "mixed.referenceAudio",
                key: "referenceAudios",
                kind: "audio",
                max: 3,
            });
        } else if (seg.mode === "source_video") {
            renderSourceVideo(container, seg);
            renderIdentityBlock(container, seg);
            renderReferenceList(container, seg, {
                titleKey: "mixed.referenceAudio",
                key: "referenceAudios",
                kind: "audio",
                max: 3,
            });
        }
    }

    function renderTimeline(panel) {
        const toolbar = document.createElement("div");
        toolbar.className = "mmx-mixed-toolbar";
        appendActionButton(toolbar, "mixed.addSegment", "add-segment", () => mutate(() => {
            state.segments.push(newMixedSegment({ idFactory: uid, duration: 5 }));
            selectedIndex = state.segments.length - 1;
        }), { primary: true });
        const runLabel = document.createElement("label");
        runLabel.className = "mmx-mixed-toggle";
        const run = document.createElement("input");
        run.type = "checkbox";
        run.checked = !!state.runSelectEnabled;
        run.onchange = () => mutate(() => {
            state.runSelectEnabled = run.checked;
            state.runSelection = run.checked ? [...Array(state.segments.length).keys()] : [];
        });
        const runText = document.createElement("span");
        setI18n(runText, "mixed.runSelect");
        runLabel.append(run, runText);
        toolbar.appendChild(runLabel);
        const spacer = document.createElement("span");
        spacer.className = "mmx-spacer";
        toolbar.appendChild(spacer);
        panel.appendChild(toolbar);

        const errors = validateMixedReferences(state.segments, state.frameRate || 24);
        const invalidIds = new Set(errors.map((error) => String(error.consumerId)));
        const cards = document.createElement("div");
        cards.className = "mmx-mixed-cards";
        state.segments.forEach((seg, index) => {
            const card = document.createElement("div");
            card.className = `bd-panel mmx-mixed-card${index === selectedIndex ? " selected" : ""}${invalidIds.has(String(seg.id)) ? " invalid" : ""}`;
            card.onclick = () => { selectedIndex = index; draw(); };
            const head = document.createElement("div");
            head.className = "mmx-mixed-card-head";
            const label = document.createElement("b");
            setI18n(label, "mixed.segment", { n: index + 1 });
            const mode = document.createElement("span");
            mode.className = "bd-meta";
            mode.textContent = modeLabel(seg.mode);
            head.append(label, mode);
            if (state.runSelectEnabled) {
                const check = document.createElement("input");
                check.type = "checkbox";
                check.checked = state.runSelection.includes(index);
                check.onclick = (event) => event.stopPropagation();
                check.onchange = () => mutate(() => {
                    const set = new Set(state.runSelection || []);
                    if (check.checked) set.add(index); else set.delete(index);
                    state.runSelection = [...set].sort((a, b) => a - b);
                });
                head.appendChild(check);
            }
            const prompt = document.createElement("div");
            prompt.className = "bd-meta mmx-mixed-card-prompt";
            prompt.textContent = seg.prompt || "—";
            const actions = document.createElement("div");
            actions.className = "mmx-mixed-card-actions";
            appendActionButton(actions, "mixed.moveLeft", `move-left-${index}`, () => {
                if (index <= 0) return;
                mutate(() => {
                    state.segments = moveMixedSegment(state.segments, index, index - 1);
                    selectedIndex = index - 1;
                });
            }, { disabled: index <= 0 });
            appendActionButton(actions, "mixed.moveRight", `move-right-${index}`, () => {
                if (index >= state.segments.length - 1) return;
                mutate(() => {
                    state.segments = moveMixedSegment(state.segments, index, index + 1);
                    selectedIndex = index + 1;
                });
            }, { disabled: index >= state.segments.length - 1 });
            appendActionButton(actions, "mixed.duplicate", `duplicate-${index}`, () => mutate(() => {
                state.segments = duplicateMixedSegment(state.segments, index, { idFactory: uid });
                selectedIndex = index + 1;
            }));
            appendActionButton(actions, "mixed.delete", `delete-${index}`, () => {
                if (state.segments.length <= 1) return;
                const dependents = referencedDependents(state.segments, seg.id);
                const message = dependents.length ? mt("mixed.deleteReferenced") : mt("mixed.deleteConfirm");
                if (!window.confirm(message)) return;
                mutate(() => {
                    state.segments.splice(index, 1);
                    selectedIndex = Math.min(index, state.segments.length - 1);
                });
            }, { disabled: state.segments.length <= 1 });
            card.append(head, prompt, actions);
            cards.appendChild(card);
        });
        panel.appendChild(cards);
    }

    function renderEditor(panel, continuityPanel) {
        const seg = selectedSegment();
        if (!seg) return;
        seg.inputs = seg.inputs || { resultRefs: [] };
        seg.inputs.resultRefs = Array.isArray(seg.inputs.resultRefs) ? seg.inputs.resultRefs : [];

        const header = document.createElement("div");
        header.className = "bd-seg-head";
        const title = document.createElement("b");
        setI18n(title, "mixed.segment", { n: selectedIndex + 1 });
        header.appendChild(title);
        panel.appendChild(header);

        const modeField = document.createElement("div");
        modeField.className = "mmx-mixed-field";
        const modeLabelEl = document.createElement("span");
        modeLabelEl.className = "bd-label";
        setI18n(modeLabelEl, "mixed.mode");
        const mode = document.createElement("select");
        mode.className = "bd-select";
        for (const value of MIXED_SEGMENT_MODES) {
            const option = document.createElement("option");
            option.value = value;
            option.dataset.mmxI18n = `mixed.mode.${value}`;
            option.textContent = modeLabel(value);
            mode.appendChild(option);
        }
        mode.value = seg.mode;
        mode.onchange = () => mutate(() => {
            seg.mode = mode.value;
            seg.inputs = { resultRefs: [], identityPictures: [] };
            seg.backendTask = backendTaskPreview(seg.mode, 0);
        });
        modeField.append(modeLabelEl, mode);
        panel.appendChild(modeField);

        renderMixedNativeModeCard({
            container: panel,
            segment: seg,
            segmentIndex: selectedIndex,
            segments: state.segments,
            mutate,
            upload: uploadDescriptor,
            probeVideo,
            viewUrl,
            status,
            onPromptInput: (value) => {
                seg.prompt = value;
                onChange?.(clone(state));
            },
            tr: mt,
            frameRate: state.frameRate || 24,
        });

        const continuityTitle = document.createElement("b");
        setI18n(continuityTitle, "mixed.continuity");
        continuityPanel.appendChild(continuityTitle);
        if (selectedIndex === 0) {
            const note = document.createElement("div");
            note.className = "bd-meta";
            setI18n(note, "mixed.rootNoContinuity");
            continuityPanel.appendChild(note);
        } else {
            for (const [key, textKey] of [["visual", "mixed.visualContext"], ["audio", "mixed.audioContext"]]) {
                const label = document.createElement("label");
                label.className = "mmx-mixed-toggle";
                const input = document.createElement("input");
                input.type = "checkbox";
                input.checked = !!seg.continuity?.[key];
                input.onchange = () => mutate(() => {
                    seg.continuity = seg.continuity || {};
                    seg.continuity[key] = input.checked;
                });
                const text = document.createElement("span");
                setI18n(text, textKey);
                label.append(input, text);
                continuityPanel.appendChild(label);
            }
        }
        const errors = validateMixedReferences(state.segments, state.frameRate || 24).filter((error) => String(error.consumerId) === String(seg.id));
        for (const _error of errors) {
            const warning = document.createElement("div");
            warning.className = "bd-meta mmx-mixed-warning";
            setI18n(warning, "mixed.referenceMissing");
            continuityPanel.appendChild(warning);
        }
    }

    function draw() {
        if (destroyed) return;
        root.replaceChildren();
        const timeline = document.createElement("section");
        timeline.className = "bd-panel mmx-mixed-timeline-panel";
        renderTimeline(timeline);
        const grid = document.createElement("div");
        grid.className = "mmx-mixed-editor-grid";
        const editorPanel = document.createElement("section");
        editorPanel.className = "bd-panel mmx-mixed-editor-panel";
        const continuityPanel = document.createElement("section");
        continuityPanel.className = "bd-panel mmx-mixed-continuity-panel";
        renderEditor(editorPanel, continuityPanel);
        if (selectedIndex > 0) grid.appendChild(continuityPanel);
        grid.appendChild(editorPanel);
        root.append(timeline, grid);
        const statusEl = document.createElement("div");
        statusEl.className = "bd-meta mmx-mixed-status";
        statusEl.textContent = mt("mixed.ready");
        editorPanel.appendChild(statusEl);
        refreshLocale(root);
        // Counts include dynamic values, so refresh them after generic locale pass.
        const identityTitle = root.querySelector('.mmx-mixed-media-head b[data-mmx-i18n="mixed.identity"]');
        if (identityTitle) identityTitle.textContent = `${mt("mixed.identity")} (${identityTotal(selectedSegment())}/9)`;
    }

    const localeUnsub = onMixedLocaleChange(() => {
        if (destroyed) return;
        refreshLocale(root);
        const identityTitle = root.querySelector('.mmx-mixed-media-head b[data-mmx-i18n="mixed.identity"]');
        if (identityTitle) identityTitle.textContent = `${mt("mixed.identity")} (${identityTotal(selectedSegment())}/9)`;
    });

    draw();
    const controller = {
        root,
        get state() { return state; },
        get selectedIndex() { return selectedIndex; },
        get selectedSegment() { return selectedSegment(); },
        commitExternalMutation() { notify(); },
        setState(next) {
            state = normalizeMixedTimeline(next || createDefaultMixedTimeline(editor), { idFactory: uid });
            canonicalRunSelection(state);
            selectedIndex = Math.min(selectedIndex, state.segments.length - 1);
            draw();
        },
        updateLocale() { refreshLocale(root); },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            localeUnsub?.();
            root.remove();
        },
    };
    return controller;
}
