// MiniMax H3 Motion Director — Material Library modal, CRUD and task allocation.

import {
    MAX_REFERENCE_AUDIOS,
    MAX_REFERENCE_IMAGES,
    MAX_REFERENCE_VIDEOS,
    newBatchSegment,
} from "./minimax_gen_timeline.js";
import { normalizeImageBatchSegments } from "./minimax_image_batch.js";
import { newFl2vShot, syncFl2vFromShots } from "./minimax_fl2v.js";
import { ensureR2vReferenceAssetSchema, ensureReferenceAssetSchema } from "./minimax_reference_assets.mjs";
import {
    createMaterialLibraryState,
    ensureMaterialLibraryMode,
    addMaterialOccurrence,
    removeLastMaterialOccurrence,
    ordersForMaterial,
    queueCounts,
    clearSelectionsForTypeAndCategory,
    clearAllSelections,
} from "./minimax_material_library_state.mjs";
import { buildMaterialAllocationPlan } from "./minimax_material_library_allocation.mjs";
import {
    createPromptMaterial,
    createMaterialCategory,
    deleteMaterial,
    fetchMaterialAsFile,
    inputRelativePath,
    listMaterialLibrary,
    materialContentUrl,
    materializeMaterial,
    renameMaterialCategory,
    updateMaterial,
    uploadMediaMaterial,
} from "./minimax_material_library_api.mjs";
import { materialCategories, mlT, onMaterialLocaleChange } from "./minimax_material_library_i18n.mjs";

const STYLE_ID = "mmx-material-library-styles";
const TYPE_ORDER = ["image", "audio", "video", "prompt"];
const TYPE_ALLOWED = {
    t2v: new Set(["prompt"]),
    i2v: new Set(["image", "prompt"]),
    fl2v: new Set(["image", "prompt"]),
    r2v: new Set(["image", "audio", "video", "prompt"]),
    rv2v: new Set(["image", "audio", "prompt"]),
    v2v: new Set(["video", "prompt"]),
};

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.mmx-material-library-button{margin-left:2px;border-color:#4f667a!important;background:#1a2732!important;color:#d9ecff!important}
.mmx-material-library-button:hover{background:#213747!important;border-color:#6e94b4!important}
.mmx-ml-layer{position:absolute;inset:0;z-index:240;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;background:rgba(0,0,0,.55);pointer-events:auto}
.mmx-ml-layer[hidden]{display:none!important}
.mmx-ml-shell{width:min(1060px,calc(100% - 32px));height:min(760px,calc(100% - 32px));max-width:calc(100% - 32px);max-height:calc(100% - 32px);min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid #3b4651;border-radius:12px;background:#15191d;color:#ddd;box-shadow:0 24px 70px rgba(0,0,0,.72);font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
.mmx-ml-head{height:46px;flex:0 0 46px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid #303941;background:#181e23;box-sizing:border-box}
.mmx-ml-title{font-size:14px;font-weight:700;color:#f0f4f7;margin-right:auto}
.mmx-ml-head button,.mmx-ml-toolbar button,.mmx-ml-footer button,.mmx-ml-targets button,.mmx-ml-role button,.mmx-ml-prompt-mode button,.mmx-ml-editor-actions button{border:1px solid #424b53;border-radius:6px;background:#232a30;color:#ddd;padding:6px 10px;cursor:pointer;font-size:12px}
.mmx-ml-head button:hover,.mmx-ml-toolbar button:hover,.mmx-ml-footer button:hover,.mmx-ml-targets button:hover,.mmx-ml-role button:hover,.mmx-ml-prompt-mode button:hover,.mmx-ml-editor-actions button:hover{border-color:#697782;background:#2d363d;color:#fff}
.mmx-ml-tabs{height:44px;flex:0 0 44px;display:flex;align-items:end;gap:4px;padding:0 12px;border-bottom:1px solid #303941;background:#12171a;box-sizing:border-box}
.mmx-ml-tab{height:35px;min-width:90px;border:1px solid transparent;border-bottom:0;border-radius:7px 7px 0 0;background:#1b2025;color:#aaa;cursor:pointer;font-weight:650}
.mmx-ml-tab[data-type=image]{--ml-color:#4aa8ff}.mmx-ml-tab[data-type=audio]{--ml-color:#f5a742}.mmx-ml-tab[data-type=video]{--ml-color:#ad78ff}.mmx-ml-tab[data-type=prompt]{--ml-color:#55cc86}
.mmx-ml-tab.active{border-color:var(--ml-color);color:var(--ml-color);background:#20262b}.mmx-ml-tab:disabled{opacity:.28;cursor:not-allowed}
.mmx-ml-context{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #2d343a;background:#161b1f}
.mmx-ml-context-label{font-size:11px;color:#929da5}.mmx-ml-targets,.mmx-ml-role,.mmx-ml-prompt-mode{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.mmx-ml-targets button.active,.mmx-ml-role button.active,.mmx-ml-prompt-mode button.active{border-color:#69b8ff;color:#d9efff;background:#1d3c54}
.mmx-ml-role button[data-role=first].active{border-color:#4aa8ff;color:#7ec1ff;background:#19344b}.mmx-ml-role button[data-role=last].active{border-color:#f2a044;color:#ffc078;background:#49301a}
.mmx-ml-prompt-mode button.active{border-color:#55cc86;color:#7fe5a7;background:#183927}
.mmx-ml-subtabs{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid #303941;background:#151a1e;overflow:auto}.mmx-ml-subtabs::-webkit-scrollbar{height:8px}.mmx-ml-subtab-wrap{display:inline-flex;align-items:center;gap:3px;flex:0 0 auto}.mmx-ml-subtab{height:30px;padding:0 10px;border:1px solid #3f4a53;border-radius:7px;background:#1b2025;color:#b9c3ca;cursor:pointer;white-space:nowrap}.mmx-ml-subtab.active{border-color:#69b8ff;background:#1d3c54;color:#d9efff}.mmx-ml-subedit,.mmx-ml-subadd{width:28px;height:28px;padding:0!important;display:inline-flex;align-items:center;justify-content:center;border:1px solid #3f4a53;border-radius:7px;background:#1b2025;color:#c7d0d6;cursor:pointer;flex:0 0 auto}.mmx-ml-subedit:hover,.mmx-ml-subadd:hover{border-color:#69b8ff;color:#fff;background:#223844}
.mmx-ml-toolbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #303941;background:#181d21;flex-wrap:wrap}
.mmx-ml-search{flex:1 1 280px;min-width:120px;border:1px solid #3c464f;border-radius:6px;background:#101417;color:#eee;padding:7px 9px;outline:none}.mmx-ml-search:focus{border-color:#63829b}
.mmx-ml-add,.mmx-ml-clear-page,.mmx-ml-clear-all{white-space:nowrap}.mmx-ml-status{min-height:18px;flex:0 0 auto;padding:3px 12px;color:#9fb1be;font-size:11px;background:#14191d}.mmx-ml-status.error{color:#ff8d8d}.mmx-ml-status.ok{color:#72d99b}
.mmx-ml-grid-wrap{position:relative;flex:1 1 auto;min-height:0;overflow:auto;padding:10px 12px;background:#101417}
.mmx-ml-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;align-content:start}.mmx-ml-empty{grid-column:1/-1;padding:44px;text-align:center;color:#77838c}
.mmx-ml-card{--ml-color:#777;position:relative;min-height:138px;overflow:hidden;border:2px solid #303941;border-radius:9px;background:#1a2025;cursor:pointer;user-select:none;box-sizing:border-box;transition:border-color .12s,box-shadow .12s,transform .12s}.mmx-ml-card:hover{border-color:#56636d;transform:translateY(-1px)}
.mmx-ml-card[data-type=image]{--ml-color:#4aa8ff}.mmx-ml-card[data-type=audio]{--ml-color:#f5a742}.mmx-ml-card[data-type=video]{--ml-color:#ad78ff}.mmx-ml-card[data-type=prompt]{--ml-color:#55cc86}
.mmx-ml-card.selected{border-color:var(--ml-color);box-shadow:0 0 0 1px color-mix(in srgb,var(--ml-color) 45%,transparent)}
.mmx-ml-card.sel-first{border-color:#4aa8ff;box-shadow:inset 0 0 0 1px #4aa8ff}.mmx-ml-card.sel-last{border-color:#f2a044;box-shadow:inset 0 0 0 1px #f2a044}.mmx-ml-card.sel-first.sel-last{border-color:#4aa8ff;box-shadow:inset 0 0 0 2px #f2a044,0 0 0 1px #4aa8ff}
.mmx-ml-badges{position:absolute;z-index:5;left:6px;top:6px;display:flex;gap:3px;max-width:calc(100% - 12px);flex-wrap:wrap}.mmx-ml-order{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--ml-color);color:#071015;font-size:10px;font-weight:800;box-shadow:0 1px 5px rgba(0,0,0,.65)}.mmx-ml-order.first{background:#4aa8ff}.mmx-ml-order.last{background:#f2a044}
.mmx-ml-preview-media{height:86px;background:#0b0e10;display:flex;align-items:center;justify-content:center;overflow:hidden}.mmx-ml-preview-media img,.mmx-ml-preview-media video{width:100%;height:100%;object-fit:contain;object-position:center;pointer-events:none}.mmx-ml-media-icon{font-size:30px;opacity:.6}.mmx-ml-prompt-preview{height:86px;padding:12px 9px 8px;box-sizing:border-box;color:#b6c2c9;font-size:11px;line-height:1.35;white-space:pre-wrap;overflow:hidden;background:#121b16}
.mmx-ml-card-meta{padding:7px 8px 8px}.mmx-ml-card-title{font-size:12px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#ecf0f2}.mmx-ml-card-sub{font-size:10px;color:#87939b;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mmx-ml-card-actions{position:absolute;left:5px;top:5px;display:flex;gap:3px;z-index:6;opacity:0;transition:opacity .1s}.mmx-ml-card:hover .mmx-ml-card-actions{opacity:1}.mmx-ml-card-actions button{width:27px;height:24px;padding:0;border:1px solid #48535c;border-radius:5px;background:rgba(22,28,32,.92);color:#cbd3d8;cursor:pointer}
.mmx-ml-footer{flex:0 0 auto;border-top:1px solid #303941;background:#171c20}.mmx-ml-summary{display:flex;align-items:center;gap:10px;padding:7px 12px;font-size:11px;color:#9aa5ad}.mmx-ml-summary strong{color:#d8e0e5}.mmx-ml-preview-toggle{margin-left:auto;border:0!important;background:transparent!important;color:#8fc6ef!important;padding:2px 4px!important}.mmx-ml-preview{max-height:154px;overflow:auto;border-top:1px solid #293037;padding:7px 12px;font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;color:#aeb9c0;background:#111619}.mmx-ml-preview[hidden]{display:none!important}.mmx-ml-preview-line.warn{color:#f5b55f}.mmx-ml-preview-line.block{color:#ff8585}.mmx-ml-footer-actions{display:flex;justify-content:flex-end;gap:8px;padding:8px 12px}.mmx-ml-apply{border-color:#3e9d67!important;background:#1c5435!important;color:#d8ffe8!important;font-weight:700}.mmx-ml-apply:disabled{opacity:.35;cursor:not-allowed}
.mmx-ml-editor,.mmx-ml-viewer{position:absolute;inset:10%;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);border-radius:10px}.mmx-ml-editor[hidden],.mmx-ml-viewer[hidden]{display:none!important}.mmx-ml-editor-card{width:min(560px,90%);max-height:90%;overflow:auto;border:1px solid #46515a;border-radius:10px;background:#1b2126;padding:14px;box-shadow:0 15px 50px rgba(0,0,0,.7)}.mmx-ml-editor-card label{display:block;margin:9px 0 4px;color:#aeb8bf;font-size:11px}.mmx-ml-editor-card input,.mmx-ml-editor-card select,.mmx-ml-editor-card textarea{width:100%;box-sizing:border-box;border:1px solid #414b53;border-radius:6px;background:#101417;color:#eee;padding:8px}.mmx-ml-editor-card textarea{min-height:180px;resize:vertical}.mmx-ml-editor-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.mmx-ml-viewer-card{width:min(960px,94%);height:min(86%,94%);display:flex;flex-direction:column;border:1px solid #46515a;border-radius:10px;background:#101417;box-shadow:0 15px 50px rgba(0,0,0,.7);overflow:hidden}.mmx-ml-viewer-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #2f373d;background:#171d21;color:#eef2f5}.mmx-ml-viewer-body{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;background:#0a0d0f;padding:12px}.mmx-ml-viewer-body img,.mmx-ml-viewer-body video{max-width:100%;max-height:100%;object-fit:contain}.mmx-ml-viewer-text{width:100%;height:100%;overflow:auto;white-space:pre-wrap;color:#d2dde5;font:13px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;background:#11171b;padding:14px;box-sizing:border-box}
`;
    document.head.appendChild(style);
}

function currentMode(editor) {
    return String(editor?.getTaskKey?.() || editor?.globalTask?.value || editor?.timeline?.global?.taskType || "t2v").trim().toLowerCase();
}

function allowedTypes(mode) { return TYPE_ALLOWED[mode] || new Set(["prompt"]); }

function firstAllowedType(mode) {
    const allowed = allowedTypes(mode);
    return TYPE_ORDER.find((kind) => allowed.has(kind)) || "prompt";
}

function relativeName(item) { return item?.original_name || item?.title || item?.id || "material"; }

function extensionKindAccept(kind) {
    if (kind === "image") return "image/*";
    if (kind === "audio") return "audio/*";
    if (kind === "video") return "video/*";
    return "";
}

function applyPromptText(existing, incoming, mode) {
    const next = String(incoming || "");
    if (mode === "replace") return next;
    const old = String(existing || "").trimEnd();
    return old ? `${old}\n${next}` : next;
}

function compactTargetLabel(target) {
    if (target === "common") return mlT("common");
    const match = String(target || "").match(/^segment:(\d+)$/);
    return match ? `S${Number(match[1]) + 1}` : "—";
}

function selectedCountTotal(state) {
    const c = queueCounts(state);
    return c.image + c.audio + c.video + c.prompt;
}

/**
 * Describe only the allocation intent that changes what Apply writes. UI-only
 * state such as search/category/active tab is intentionally excluded, so
 * browsing the library never makes an already-applied selection executable again.
 */
function materialApplySignature(state) {
    const mediaQueue = (entries) => (entries || []).map((entry) => String(entry?.itemId || ""));
    const promptQueue = (entries) => (entries || []).map((entry) => [
        String(entry?.itemId || ""),
        String(entry?.item?.content || ""),
    ]);
    return JSON.stringify({
        mode: String(state?.mode || ""),
        target: state?.target == null ? null : String(state.target),
        promptApplyMode: String(state?.promptApplyMode || "append"),
        images: mediaQueue(state?.images),
        audio: mediaQueue(state?.audio),
        videos: mediaQueue(state?.videos),
        prompts: promptQueue(state?.prompts),
        firstFrames: mediaQueue(state?.fl2vFirstFrames),
        lastFrames: mediaQueue(state?.fl2vLastFrames),
    });
}

function ensureSegments(editor, mode, count) {
    editor.timeline.segments = Array.isArray(editor.timeline.segments) ? editor.timeline.segments : [];
    while (editor.timeline.segments.length < count) {
        editor.timeline.segments.push(newBatchSegment({ taskType: mode, prompt: "" }));
    }
}

function nextFreeSlot(items, limit) {
    const used = new Set((items || []).map((item) => Number(item?.index ?? item?.slot)).filter(Number.isFinite));
    for (let index = 0; index < limit; index += 1) if (!used.has(index)) return index;
    return null;
}

function refRecord(kind, materialized, item, index) {
    const path = inputRelativePath(materialized);
    if (kind === "image") return { index, imageFile: path, imageB64: "" };
    if (kind === "audio") return {
        index,
        audioFile: path,
        fileName: materialized.name || relativeName(item),
        type: "input",
        subfolder: materialized.subfolder || "",
    };
    return {
        index,
        videoFile: path,
        fileName: materialized.name || relativeName(item),
        type: "input",
        subfolder: materialized.subfolder || "",
        pairedAudioFile: "",
        previewImageFile: "",
        previewImageUrl: "",
        linked: true,
    };
}

async function appendReferences(container, state, materialize, status) {
    container.refs = Array.isArray(container.refs) ? container.refs : [];
    container.refAudios = Array.isArray(container.refAudios) ? container.refAudios : [];
    container.refVideos = Array.isArray(container.refVideos) ? container.refVideos : [];
    const specs = [
        ["image", state.images, "refs", MAX_REFERENCE_IMAGES, mlT("picture")],
        ["audio", state.audio, "refAudios", MAX_REFERENCE_AUDIOS, mlT("audio")],
        ["video", state.videos, "refVideos", MAX_REFERENCE_VIDEOS, mlT("video")],
    ];
    for (const [kind, queue, field, limit, label] of specs) {
        let fullWarned = false;
        for (const entry of queue) {
            const slot = nextFreeSlot(container[field], limit);
            if (slot == null) {
                if (!fullWarned) status(mlT("noFreeSlot", { type: label }), "error");
                fullWarned = true;
                continue;
            }
            const mat = await materialize(entry.item);
            container[field].push(refRecord(kind, mat, entry.item, slot));
        }
    }
}

function refreshEditor(editor, { fl2v = false, referenceSchema = null } = {}) {
    if (referenceSchema === "r2v") ensureR2vReferenceAssetSchema(editor.timeline);
    else if (referenceSchema === "generic") ensureReferenceAssetSchema(editor.timeline);
    if (fl2v) syncFl2vFromShots(editor);
    else if (["t2v", "i2v", "r2v"].includes(currentMode(editor))) normalizeImageBatchSegments(editor);
    editor.renderImageBatchGroups?.();
    editor.updateSelectionUI?.();
    editor.updateVideoNameLabel?.();
    editor.updateDomWidgetHeight?.();
    editor.scheduleRender?.();
    editor.commit?.(false, { syncTimeline: true });
}

export function mountMaterialLibrary(editor, node = null) {
    if (!editor || editor._materialLibraryController) return editor?._materialLibraryController || null;
    const outputBar = editor.outputBarEl;
    const modalHost = editor._directorModalController?.overlayLayer;
    if (!outputBar || !modalHost) return null;
    ensureStyles();

    const button = document.createElement("button");
    button.type = "button";
    button.className = "bd-btn mmx-material-library-button";
    button.dataset.a = "material-library";
    const live = outputBar.querySelector('[data-a="live-tae-preview"]');
    if (live) live.insertAdjacentElement("afterend", button);
    else outputBar.appendChild(button);

    const layer = document.createElement("div");
    layer.className = "mmx-ml-layer";
    layer.hidden = true;
    layer.innerHTML = `
      <section class="mmx-ml-shell" role="dialog" aria-modal="true">
        <header class="mmx-ml-head"><div class="mmx-ml-title"></div><button type="button" data-ml="close">×</button></header>
        <div class="mmx-ml-tabs"></div>
        <div class="mmx-ml-context"></div>
        <div class="mmx-ml-subtabs"></div>
        <div class="mmx-ml-toolbar">
          <input class="mmx-ml-search" type="search">
          <button type="button" class="mmx-ml-clear-page" data-ml="clear-page"></button>
          <button type="button" class="mmx-ml-clear-all" data-ml="clear-all"></button>
          <button type="button" class="mmx-ml-add" data-ml="add"></button>
        </div>
        <div class="mmx-ml-status"></div>
        <div class="mmx-ml-grid-wrap"><div class="mmx-ml-grid"></div></div>
        <footer class="mmx-ml-footer">
          <div class="mmx-ml-summary"><strong data-ml="counts"></strong><button type="button" class="mmx-ml-preview-toggle" data-ml="preview-toggle"></button></div>
          <div class="mmx-ml-preview" hidden></div>
          <div class="mmx-ml-footer-actions"><button type="button" data-ml="cancel"></button><button type="button" class="mmx-ml-apply" data-ml="apply"></button></div>
        </footer>
        <div class="mmx-ml-editor" hidden><div class="mmx-ml-editor-card"></div></div>
        <div class="mmx-ml-viewer" hidden><div class="mmx-ml-viewer-card"><div class="mmx-ml-viewer-head"><div class="mmx-ml-title"></div><button type="button" data-ml="viewer-close">×</button></div><div class="mmx-ml-viewer-body"></div></div></div>
      </section>`;
    modalHost.appendChild(layer);

    const shell = layer.querySelector(".mmx-ml-shell");
    const tabsEl = layer.querySelector(".mmx-ml-tabs");
    const contextEl = layer.querySelector(".mmx-ml-context");
    const subtabsEl = layer.querySelector(".mmx-ml-subtabs");
    const gridEl = layer.querySelector(".mmx-ml-grid");
    const statusEl = layer.querySelector(".mmx-ml-status");
    const searchEl = layer.querySelector(".mmx-ml-search");
    const previewEl = layer.querySelector(".mmx-ml-preview");
    const editorOverlay = layer.querySelector(".mmx-ml-editor");
    const editorCard = layer.querySelector(".mmx-ml-editor-card");
    const viewerOverlay = layer.querySelector(".mmx-ml-viewer");
    const viewerTitle = layer.querySelector(".mmx-ml-viewer-head .mmx-ml-title");
    const viewerBody = layer.querySelector(".mmx-ml-viewer-body");
    const hadState = !!editor._materialLibraryState;
    let state = editor._materialLibraryState || createMaterialLibraryState(currentMode(editor));
    if (!hadState) state.activeType = firstAllowedType(state.mode);
    editor._materialLibraryState = state;
    let items = [];
    let loading = false;
    let applying = false;
    let previewOpen = false;
    let categoriesByType = Object.fromEntries(TYPE_ORDER.map((kind) => [kind, [...materialCategories(kind)]]));
    let lastAppliedSignature = null;

    const setStatus = (message = "", kind = "") => {
        statusEl.textContent = message;
        statusEl.className = `mmx-ml-status${kind ? ` ${kind}` : ""}`;
    };

    const markSelectionChanged = () => { lastAppliedSignature = null; };

    const syncStateMode = () => {
        const before = state.mode;
        state = ensureMaterialLibraryMode(state, currentMode(editor));
        editor._materialLibraryState = state;
        if (before !== state.mode) {
            state.activeType = firstAllowedType(state.mode);
            state.activeCategory = "";
            lastAppliedSignature = null;
            setStatus("");
        }
        if (!allowedTypes(state.mode).has(state.activeType)) state.activeType = firstAllowedType(state.mode);
        if (state.mode === "r2v" && state.target === "common" && state.activeType === "prompt") state.activeType = "image";
    };

    const allQueues = () => [
        ["image", null], ["audio", null], ["video", null], ["prompt", null],
        ["image", "first"], ["image", "last"],
    ];

    const purgeItemSelections = (itemId) => {
        for (const [kind, role] of allQueues()) {
            while (removeLastMaterialOccurrence(state, kind, itemId, role)) { /* remove all */ }
        }
    };

    const syncQueuedItem = (updated) => {
        for (const key of ["images", "audio", "videos", "prompts", "fl2vFirstFrames", "fl2vLastFrames"]) {
            for (const entry of state[key] || []) if (entry.itemId === updated.id) entry.item = updated;
        }
    };

    const renderLocale = () => {
        button.textContent = mlT("button");
        button.title = mlT("title");
        layer.querySelector(".mmx-ml-title").textContent = mlT("title");
        layer.querySelector('[data-ml="close"]').title = mlT("close");
        searchEl.placeholder = mlT("search");
        layer.querySelector('[data-ml="add"]').textContent = mlT("add");
        layer.querySelector('[data-ml="clear-page"]').textContent = mlT("clearPage");
        layer.querySelector('[data-ml="clear-all"]').textContent = mlT("clearAll");
        layer.querySelector('[data-ml="cancel"]').textContent = mlT("cancel");
        layer.querySelector('[data-ml="preview-toggle"]').textContent = mlT("preview");
        layer.querySelector('[data-ml="viewer-close"]').title = mlT("close");
        renderAll();
    };

    const renderTabs = () => {
        tabsEl.replaceChildren();
        const allowed = allowedTypes(state.mode);
        for (const kind of TYPE_ORDER) {
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = `mmx-ml-tab${state.activeType === kind ? " active" : ""}`;
            tab.dataset.type = kind;
            tab.textContent = mlT(kind);
            tab.disabled = !allowed.has(kind) || (state.mode === "r2v" && state.target === "common" && kind === "prompt");
            tab.addEventListener("click", () => {
                if (tab.disabled) return;
                state.activeType = kind;
                state.activeCategory = "";
                renderAll();
                void reloadItems();
            });
            tabsEl.appendChild(tab);
        }
    };

    const renderContext = () => {
        contextEl.replaceChildren();
        if (state.mode === "r2v" || state.mode === "rv2v") {
            const label = document.createElement("span"); label.className = "mmx-ml-context-label"; label.textContent = `${mlT("target")}:`;
            const targets = document.createElement("div"); targets.className = "mmx-ml-targets";
            if (state.mode === "r2v") addTargetButton(targets, "common", mlT("common"));
            (editor.timeline?.segments || []).forEach((_seg, index) => addTargetButton(targets, `segment:${index}`, `S${index + 1}`));
            contextEl.append(label, targets);
            if (state.mode === "rv2v") {
                const note = document.createElement("span"); note.className = "mmx-ml-context-label"; note.textContent = mlT("sourceLocalOnly");
                contextEl.appendChild(note);
            }
        }
        if (state.mode === "fl2v" && state.activeType === "image") {
            const label = document.createElement("span"); label.className = "mmx-ml-context-label"; label.textContent = `${mlT("fl2vRole")}:`;
            const wrap = document.createElement("div"); wrap.className = "mmx-ml-role";
            for (const role of ["first", "last"]) {
                const b = document.createElement("button"); b.type = "button"; b.dataset.role = role;
                b.classList.toggle("active", state.fl2vRole === role); b.textContent = mlT(role);
                b.addEventListener("click", () => { markSelectionChanged(); state.fl2vRole = role; renderAll(); }); wrap.appendChild(b);
            }
            contextEl.append(label, wrap);
        }
        if (state.activeType === "prompt") {
            const label = document.createElement("span"); label.className = "mmx-ml-context-label"; label.textContent = `${mlT("promptMode")}:`;
            const wrap = document.createElement("div"); wrap.className = "mmx-ml-prompt-mode";
            for (const mode of ["append", "replace"]) {
                const b = document.createElement("button"); b.type = "button"; b.classList.toggle("active", state.promptApplyMode === mode);
                b.textContent = mlT(mode); b.addEventListener("click", () => { markSelectionChanged(); state.promptApplyMode = mode; renderContext(); renderPreview(); }); wrap.appendChild(b);
            }
            contextEl.append(label, wrap);
        }
    };

    function addTargetButton(parent, target, label) {
        const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.classList.toggle("active", state.target === target);
        b.addEventListener("click", () => {
            markSelectionChanged(); state.target = target;
            if (state.mode === "r2v" && target === "common" && state.activeType === "prompt") state.activeType = "image";
            renderAll();
            void reloadItems();
        });
        parent.appendChild(b);
    }

    async function createCategoryFlow() {
        const raw = window.prompt(mlT("categoryName"), "");
        if (raw == null) return;
        const name = String(raw).trim();
        if (!name) return;
        try {
            categoriesByType[state.activeType] = await createMaterialCategory({ type: state.activeType, name });
            state.activeCategory = name;
            setStatus(mlT("saved"), "ok");
            renderAll();
            await reloadItems();
        } catch (err) {
            setStatus(mlT("error", { message: err?.message || err }), "error");
        }
    }

    async function renameCategoryFlow(oldName) {
        const raw = window.prompt(mlT("categoryName"), oldName || "");
        if (raw == null) return;
        const name = String(raw).trim();
        if (!name || name === oldName) return;
        try {
            categoriesByType[state.activeType] = await renameMaterialCategory({ type: state.activeType, oldName, name });
            if (state.activeCategory === oldName) state.activeCategory = name;
            for (const key of ["images", "audio", "videos", "prompts", "fl2vFirstFrames", "fl2vLastFrames"]) {
                for (const entry of state[key] || []) {
                    if (entry?.item?.type === state.activeType && entry?.item?.category === oldName) entry.item.category = name;
                }
            }
            setStatus(mlT("saved"), "ok");
            renderAll();
            await reloadItems();
        } catch (err) {
            setStatus(mlT("error", { message: err?.message || err }), "error");
        }
    }

    function openViewer(item) {
        viewerTitle.textContent = item?.title || relativeName(item);
        viewerBody.replaceChildren();
        if (item?.type === "image") {
            const img = document.createElement("img");
            img.src = materialContentUrl(item);
            viewerBody.appendChild(img);
        } else if (item?.type === "video") {
            const video = document.createElement("video");
            video.src = materialContentUrl(item);
            video.controls = true;
            video.autoplay = true;
            viewerBody.appendChild(video);
        } else {
            const text = document.createElement("div");
            text.className = "mmx-ml-viewer-text";
            text.textContent = item?.content || item?.title || "";
            viewerBody.appendChild(text);
        }
        viewerOverlay.hidden = false;
    }

    const categoriesForType = (kind) => [...(categoriesByType[kind] || materialCategories(kind) || [])];

    const renderCategories = () => {
        subtabsEl.replaceChildren();
        const appendSubtab = (value, label) => {
            const wrap = document.createElement("div");
            wrap.className = "mmx-ml-subtab-wrap";
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = `mmx-ml-subtab${state.activeCategory === value ? " active" : ""}`;
            tab.textContent = label;
            tab.addEventListener("click", () => {
                state.activeCategory = value;
                renderAll();
                void reloadItems();
            });
            wrap.appendChild(tab);
            if (value) {
                const edit = document.createElement("button");
                edit.type = "button";
                edit.className = "mmx-ml-subedit";
                edit.textContent = "✎";
                edit.title = mlT("renameCategory");
                edit.addEventListener("click", (event) => { event.stopPropagation(); void renameCategoryFlow(value); });
                wrap.appendChild(edit);
            }
            subtabsEl.appendChild(wrap);
        };
        appendSubtab("", mlT("allCategories"));
        for (const category of categoriesForType(state.activeType)) appendSubtab(category, category);
        const addButton = document.createElement("button");
        addButton.type = "button";
        addButton.className = "mmx-ml-subadd";
        addButton.textContent = "+";
        addButton.title = mlT("addCategory");
        addButton.addEventListener("click", () => void createCategoryFlow());
        subtabsEl.appendChild(addButton);
    };

    const itemOrders = (item) => {
        if (state.mode === "fl2v" && item.type === "image") {
            return {
                first: ordersForMaterial(state, "image", item.id, "first"),
                last: ordersForMaterial(state, "image", item.id, "last"),
            };
        }
        return { normal: ordersForMaterial(state, item.type, item.id, null) };
    };

    const renderGrid = () => {
        gridEl.replaceChildren();
        if (loading) {
            const empty = document.createElement("div"); empty.className = "mmx-ml-empty"; empty.textContent = "…"; gridEl.appendChild(empty); return;
        }
        if (!items.length) {
            const empty = document.createElement("div"); empty.className = "mmx-ml-empty";
            empty.textContent = state.search ? mlT("emptySearch") : mlT("empty"); gridEl.appendChild(empty); return;
        }
        for (const item of items) gridEl.appendChild(createCard(item));
    };

    const createCard = (item) => {
        const card = document.createElement("article");
        card.className = "mmx-ml-card"; card.dataset.type = item.type; card.dataset.id = item.id;
        const orders = itemOrders(item);
        if (orders.normal?.length) card.classList.add("selected");
        if (orders.first?.length) card.classList.add("sel-first");
        if (orders.last?.length) card.classList.add("sel-last");
        const badges = document.createElement("div"); badges.className = "mmx-ml-badges";
        const appendBadges = (values, cls = "") => values.forEach((n) => {
            const badge = document.createElement("span"); badge.className = `mmx-ml-order${cls ? ` ${cls}` : ""}`; badge.textContent = String(n); badges.appendChild(badge);
        });
        appendBadges(orders.normal || []);
        appendBadges(orders.first || [], "first"); appendBadges(orders.last || [], "last");
        card.appendChild(badges);

        const actions = document.createElement("div"); actions.className = "mmx-ml-card-actions";
        const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "✎"; edit.title = mlT("edit");
        edit.addEventListener("click", (event) => { event.stopPropagation(); openItemEditor(item); });
        actions.appendChild(edit);
        const canZoom = item.type !== "audio";
        if (canZoom) {
            const zoom = document.createElement("button"); zoom.type = "button"; zoom.textContent = "⤢"; zoom.title = mlT("zoom");
            zoom.addEventListener("click", (event) => { event.stopPropagation(); openViewer(item); });
            actions.appendChild(zoom);
        }
        const del = document.createElement("button"); del.type = "button"; del.textContent = "×"; del.title = mlT("delete");
        del.addEventListener("click", async (event) => {
            event.stopPropagation();
            if (!window.confirm(mlT("confirmDelete", { title: item.title }))) return;
            try {
                await deleteMaterial(item.id); purgeItemSelections(item.id); setStatus(mlT("saved"), "ok"); await reloadItems(); renderAll();
            } catch (err) { setStatus(mlT("error", { message: err?.message || err }), "error"); }
        });
        actions.appendChild(del); card.appendChild(actions);

        if (item.type === "prompt") {
            const preview = document.createElement("div"); preview.className = "mmx-ml-prompt-preview"; preview.textContent = item.content || ""; card.appendChild(preview);
        } else {
            const preview = document.createElement("div"); preview.className = "mmx-ml-preview-media";
            if (item.type === "image") {
                const img = document.createElement("img"); img.loading = "lazy"; img.src = materialContentUrl(item); preview.appendChild(img);
            } else if (item.type === "video") {
                const video = document.createElement("video"); video.muted = true; video.preload = "metadata"; video.src = materialContentUrl(item); preview.appendChild(video);
            } else {
                const icon = document.createElement("span"); icon.className = "mmx-ml-media-icon"; icon.textContent = "♪"; preview.appendChild(icon);
            }
            card.appendChild(preview);
        }
        const meta = document.createElement("div"); meta.className = "mmx-ml-card-meta";
        const title = document.createElement("div"); title.className = "mmx-ml-card-title"; title.textContent = item.title || relativeName(item);
        const sub = document.createElement("div"); sub.className = "mmx-ml-card-sub"; sub.textContent = `${item.category || "其他"} · ${mlT(item.type)}`;
        meta.append(title, sub); card.appendChild(meta);
        card.title = mlT("leftRightHint");
        card.addEventListener("click", () => {
            const role = state.mode === "fl2v" && item.type === "image" ? state.fl2vRole : null;
            markSelectionChanged(); addMaterialOccurrence(state, item.type, item, role); renderAll();
        });
        card.addEventListener("contextmenu", (event) => {
            event.preventDefault(); event.stopPropagation();
            const role = state.mode === "fl2v" && item.type === "image" ? state.fl2vRole : null;
            markSelectionChanged(); removeLastMaterialOccurrence(state, item.type, item.id, role); renderAll();
        });
        return card;
    };

    const planBlockReason = (plan) => {
        if (plan.blockedReason === "target_required") return mlT("targetRequired");
        if (plan.blockedReason === "fl2v_prompt_without_shot") return mlT("promptNoShot");
        if (plan.blockedReason === "v2v_prompt_without_video") return mlT("v2vNoVideo");
        if (plan.blockedReason) return plan.blockedReason;
        return "";
    };

    const renderPreview = () => {
        const plan = buildMaterialAllocationPlan({ mode: state.mode, state, timeline: editor.timeline });
        const counts = queueCounts(state);
        const countText = state.mode === "fl2v"
            ? `${mlT("selected")}: ${mlT("first")} ${counts.first} · ${mlT("last")} ${counts.last} · Prompt ${counts.prompt}`
            : `${mlT("selected")}: ${mlT("image")} ${counts.image} · ${mlT("audio")} ${counts.audio} · ${mlT("video")} ${counts.video} · Prompt ${counts.prompt}`;
        layer.querySelector('[data-ml="counts"]').textContent = countText;
        previewEl.hidden = !previewOpen;
        previewEl.replaceChildren();
        if (!selectedCountTotal(state)) {
            const line = document.createElement("div"); line.textContent = mlT("previewEmpty"); previewEl.appendChild(line);
        } else {
            const block = planBlockReason(plan);
            if (block) addPreviewLine(block, "block");
            for (let i = plan.existingSegments; i < plan.requiredSegments; i += 1) addPreviewLine(mlT("createSegment", { n: i + 1 }));
            for (const a of plan.assignments) {
                const type = a.targetKind === "first_frame" ? mlT("firstFrame")
                    : a.targetKind === "last_frame" ? mlT("lastFrame")
                    : a.targetKind === "source_video" ? mlT("sourceVideo")
                    : a.targetKind.includes("picture") ? mlT("picture")
                    : a.targetKind.includes("audio") ? mlT("audio")
                    : a.targetKind.includes("video") ? mlT("video") : "Prompt";
                const target = a.targetKind.startsWith("common_") ? mlT("common") : `S${Number(a.segmentIndex) + 1}`;
                addPreviewLine(mlT("itemTo", { type, order: a.occurrenceOrder, target }));
            }
            for (const warning of plan.warnings) {
                if (warning.code === "prompt_not_allowed_common") addPreviewLine(mlT("promptCommonBlocked"), "warn");
            }
        }
        const applySignature = materialApplySignature(state);
        const alreadyApplied = lastAppliedSignature != null && lastAppliedSignature === applySignature;
        plan.applySignature = applySignature;
        plan.alreadyApplied = alreadyApplied;
        const apply = layer.querySelector('[data-ml="apply"]');
        apply.textContent = applying ? mlT("applying") : mlT("apply");
        apply.disabled = applying || alreadyApplied || !!plan.blockedReason || !plan.assignments.length;
        return plan;
    };

    function addPreviewLine(text, cls = "") {
        const line = document.createElement("div"); line.className = `mmx-ml-preview-line${cls ? ` ${cls}` : ""}`; line.textContent = text; previewEl.appendChild(line);
    }

    const renderAll = () => {
        syncStateMode(); renderTabs(); renderContext(); renderCategories(); renderGrid(); renderPreview();
    };

    async function reloadItems() {
        loading = true; renderGrid();
        try {
            const result = await listMaterialLibrary({ type: state.activeType, category: state.activeCategory, query: state.search });
            items = Array.isArray(result?.items) ? result.items : [];
            if (result?.categories && typeof result.categories === "object") {
                categoriesByType = Object.fromEntries(TYPE_ORDER.map((kind) => [kind, [...(result.categories[kind] || categoriesByType[kind] || materialCategories(kind) || [])]]));
            }
            if (state.activeCategory && !categoriesForType(state.activeType).includes(state.activeCategory)) state.activeCategory = "";
            setStatus("");
        } catch (err) { items = []; setStatus(mlT("error", { message: err?.message || err }), "error"); }
        finally { loading = false; renderAll(); }
    }

    const open = async () => {
        syncStateMode(); layer.hidden = false; renderAll(); await reloadItems(); renderAll();
        requestAnimationFrame(() => searchEl.focus({ preventScroll: true }));
    };
    const close = () => { layer.hidden = true; editorOverlay.hidden = true; viewerOverlay.hidden = true; viewerBody.replaceChildren(); };

    const openItemEditor = (item = null) => {
        const type = item?.type || state.activeType;
        if (type !== "prompt" && !item) return pickMediaFiles();
        editorOverlay.hidden = false;
        editorCard.replaceChildren();
        const title = document.createElement("div"); title.className = "mmx-ml-title"; title.textContent = item ? mlT("edit") : mlT("add");
        const titleLabel = document.createElement("label"); titleLabel.textContent = mlT("rename");
        const titleInput = document.createElement("input"); titleInput.value = item?.title || "";
        const catLabel = document.createElement("label"); catLabel.textContent = mlT("category");
        const cat = document.createElement("select");
        for (const value of categoriesForType(type)) { const o = document.createElement("option"); o.value = value; o.textContent = value; cat.appendChild(o); }
        cat.value = item?.category || state.activeCategory || "其他";
        editorCard.append(title, titleLabel, titleInput, catLabel, cat);
        let content = null;
        if (type === "prompt") {
            const contentLabel = document.createElement("label"); contentLabel.textContent = mlT("content");
            content = document.createElement("textarea"); content.value = item?.content || "";
            editorCard.append(contentLabel, content);
        }
        const actions = document.createElement("div"); actions.className = "mmx-ml-editor-actions";
        const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = mlT("cancel"); cancel.addEventListener("click", () => { editorOverlay.hidden = true; });
        const save = document.createElement("button"); save.type = "button"; save.textContent = mlT("save");
        save.addEventListener("click", async () => {
            try {
                let updated;
                if (item) updated = await updateMaterial(item.id, { title: titleInput.value, category: cat.value, ...(type === "prompt" ? { content: content.value } : {}) });
                else updated = await createPromptMaterial({ title: titleInput.value, category: cat.value, content: content.value });
                syncQueuedItem(updated); editorOverlay.hidden = true; setStatus(mlT("saved"), "ok"); await reloadItems(); renderAll();
            } catch (err) { setStatus(mlT("error", { message: err?.message || err }), "error"); }
        });
        actions.append(cancel, save); editorCard.appendChild(actions); titleInput.focus();
    };

    const pickMediaFiles = () => {
        const kind = state.activeType;
        if (kind === "prompt") return openItemEditor(null);
        const input = document.createElement("input"); input.type = "file"; input.accept = extensionKindAccept(kind); input.multiple = true;
        input.onchange = async () => {
            const files = [...(input.files || [])]; if (!files.length) return;
            for (const file of files) {
                try {
                    setStatus(mlT("uploading", { name: file.name }));
                    await uploadMediaMaterial(file, {
                        type: kind,
                        category: state.activeCategory || "其他",
                        title: file.name.replace(/\.[^.]+$/, ""),
                        onProgress: (fraction) => setStatus(`${mlT("uploading", { name: file.name })} ${Math.round(fraction * 100)}%`),
                    });
                } catch (err) { setStatus(mlT("error", { message: err?.message || err }), "error"); return; }
            }
            setStatus(mlT("saved"), "ok"); await reloadItems(); renderAll();
        };
        input.click();
    };

    const materializeCacheFactory = () => {
        const cache = new Map();
        return async (item) => {
            if (!cache.has(item.id)) cache.set(item.id, materializeMaterial(item.id));
            return cache.get(item.id);
        };
    };

    const applySequentialPrompts = (segments, promptQueue) => {
        promptQueue.forEach((entry, index) => {
            const segment = segments[index]; if (!segment) return;
            segment.prompt = applyPromptText(segment.prompt, entry.item?.content || "", state.promptApplyMode);
        });
    };

    const applyPlan = async () => {
        if (applying) return;
        const plan = renderPreview();
        if (plan.alreadyApplied || plan.blockedReason || !plan.assignments.length) return;
        applying = true; renderPreview(); setStatus("");
        const materialize = materializeCacheFactory();
        try {
            if (state.mode === "t2v") {
                ensureSegments(editor, "t2v", plan.requiredSegments);
                applySequentialPrompts(editor.timeline.segments, state.prompts);
                refreshEditor(editor);
            } else if (state.mode === "i2v") {
                ensureSegments(editor, "i2v", plan.requiredSegments);
                for (let index = 0; index < state.images.length; index += 1) {
                    const mat = await materialize(state.images[index].item);
                    editor.timeline.segments[index].genImage = { imageFile: inputRelativePath(mat) };
                }
                applySequentialPrompts(editor.timeline.segments, state.prompts);
                refreshEditor(editor);
            } else if (state.mode === "fl2v") {
                editor.timeline.shots = Array.isArray(editor.timeline.shots) ? editor.timeline.shots : [];
                while (editor.timeline.shots.length < plan.requiredSegments) editor.timeline.shots.push(newFl2vShot({ prompt: "" }));
                for (let index = 0; index < state.fl2vFirstFrames.length; index += 1) {
                    const mat = await materialize(state.fl2vFirstFrames[index].item);
                    editor.timeline.shots[index].startImage = { imageFile: inputRelativePath(mat), width: 0, height: 0 };
                }
                for (let index = 0; index < state.fl2vLastFrames.length; index += 1) {
                    const mat = await materialize(state.fl2vLastFrames[index].item);
                    editor.timeline.shots[index].endImage = { imageFile: inputRelativePath(mat), width: 0, height: 0 };
                }
                applySequentialPrompts(editor.timeline.shots, state.prompts);
                refreshEditor(editor, { fl2v: true });
            } else if (state.mode === "r2v") {
                const target = state.target === "common" ? (editor.timeline.r2vCommon ||= { refs: [], refAudios: [], refVideos: [] }) : editor.timeline.segments[parseInt(String(state.target).split(":")[1], 10)];
                await appendReferences(target, state, materialize, setStatus);
                if (state.target !== "common" && state.prompts.length) {
                    const text = state.prompts.map((entry) => entry.item?.content || "").join("\n");
                    target.prompt = applyPromptText(target.prompt, text, state.promptApplyMode);
                }
                refreshEditor(editor, { referenceSchema: "r2v" });
            } else if (state.mode === "rv2v") {
                const index = parseInt(String(state.target).split(":")[1], 10);
                const target = editor.timeline.segments[index];
                // Current Director RV2V runtime consumes source <Video 1> + Picture/Audio refs.
                // Library video stays disabled here so Source Video remains local-upload only.
                await appendReferences(target, { ...state, videos: [] }, materialize, setStatus);
                if (state.prompts.length) {
                    const text = state.prompts.map((entry) => entry.item?.content || "").join("\n");
                    target.prompt = applyPromptText(target.prompt, text, state.promptApplyMode);
                }
                refreshEditor(editor, { referenceSchema: "generic" });
            } else if (state.mode === "v2v") {
                if (state.videos.length) {
                    const fileCache = new Map();
                    const fileFor = async (item) => {
                        if (!fileCache.has(item.id)) fileCache.set(item.id, fetchMaterialAsFile(item));
                        const original = await fileCache.get(item.id);
                        return new File([original], original.name, { type: original.type, lastModified: Date.now() });
                    };
                    for (let index = 0; index < state.videos.length; index += 1) {
                        const file = await fileFor(state.videos[index].item);
                        if (index === 0) await editor.loadVideoFile(file);
                        else await editor.appendVideoFile(file);
                    }
                }
                applySequentialPrompts(editor.timeline.segments || [], state.prompts);
                editor.updateSelectionUI?.(); editor.scheduleRender?.(); editor.commit?.(false, { syncTimeline: true });
            }
            lastAppliedSignature = plan.applySignature;
            setStatus(mlT("applied"), "ok");
        } catch (err) {
            console.error("[MiniMax H3 Motion Director] Material Library apply failed", err);
            setStatus(mlT("error", { message: err?.message || err }), "error");
        } finally { applying = false; renderAll(); }
    };

    button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); void open(); });
    layer.querySelector('[data-ml="close"]').addEventListener("click", close);
    layer.querySelector('[data-ml="cancel"]').addEventListener("click", close);
    layer.querySelector('[data-ml="add"]').addEventListener("click", () => state.activeType === "prompt" ? openItemEditor(null) : pickMediaFiles());
    layer.querySelector('[data-ml="clear-page"]').addEventListener("click", () => { markSelectionChanged(); clearSelectionsForTypeAndCategory(state, state.activeType, state.activeCategory); setStatus(""); renderAll(); });
    layer.querySelector('[data-ml="clear-all"]').addEventListener("click", () => { markSelectionChanged(); clearAllSelections(state); setStatus(""); renderAll(); });
    layer.querySelector('[data-ml="apply"]').addEventListener("click", () => void applyPlan());
    layer.querySelector('[data-ml="preview-toggle"]').addEventListener("click", () => { previewOpen = !previewOpen; renderPreview(); });
    layer.querySelector('[data-ml="viewer-close"]').addEventListener("click", () => { viewerOverlay.hidden = true; viewerBody.replaceChildren(); });
    viewerOverlay.addEventListener("mousedown", (event) => { if (event.target === viewerOverlay) { viewerOverlay.hidden = true; viewerBody.replaceChildren(); } });
    layer.addEventListener("mousedown", (event) => { if (event.target === layer) close(); });
    searchEl.addEventListener("input", () => { state.search = searchEl.value; clearTimeout(searchEl._mlTimer); searchEl._mlTimer = setTimeout(() => void reloadItems(), 160); });
    editor.globalTask?.addEventListener?.("change", () => {
        ensureMaterialLibraryMode(state, currentMode(editor));
        lastAppliedSignature = null;
        state.activeType = firstAllowedType(state.mode);
        state.activeCategory = "";
        if (!layer.hidden) { renderAll(); void reloadItems(); }
    });
    const localeUnsub = onMaterialLocaleChange(() => renderLocale());
    const keyHandler = (event) => {
        if (layer.hidden || event.key !== "Escape") return;
        if (!viewerOverlay.hidden) { event.preventDefault(); event.stopImmediatePropagation(); viewerOverlay.hidden = true; viewerBody.replaceChildren(); return; }
        if (!editorOverlay.hidden) { event.preventDefault(); event.stopImmediatePropagation(); editorOverlay.hidden = true; return; }
        event.preventDefault(); event.stopImmediatePropagation(); close();
    };
    window.addEventListener("keydown", keyHandler, true);

    const controller = {
        button, layer, state,
        open, close,
        destroy() {
            localeUnsub?.(); window.removeEventListener("keydown", keyHandler, true); button.remove(); layer.remove();
            if (editor._materialLibraryController === controller) delete editor._materialLibraryController;
        },
    };
    editor._materialLibraryController = controller;
    if (!editor._materialLibraryDestroyWrapped && typeof editor.destroy === "function") {
        const originalDestroy = editor.destroy.bind(editor);
        editor._materialLibraryDestroyWrapped = true;
        editor.destroy = function (...args) {
            try { this._materialLibraryController?.destroy?.(); } catch { /* best-effort cleanup */ }
            return originalDestroy(...args);
        };
    }
    renderLocale();
    return controller;
}
