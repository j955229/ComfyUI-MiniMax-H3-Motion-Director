import { app } from "../../scripts/app.js";
import { getLocale, onLocaleChange } from "./minimax_i18n.js";

const ROOT_SELECTOR = ".mmx-postprocess";
const SAM_SELECTOR = '[data-path="face_refine.sam_model"]';
const boundSelects = new WeakSet();
let documentObserver = null;
let stopLocaleSync = null;
let scanScheduled = false;

const TEXT = {
    en: "No compatible SAM .pt model found. Put an Ultralytics SAM/SAM2 checkpoint in ComfyUI/models/sams.",
    zh: "未找到兼容的 SAM .pt 模型。请将 Ultralytics SAM/SAM2 checkpoint 放入 ComfyUI/models/sams。",
};

function language() {
    return getLocale?.() === "en" ? "en" : "zh";
}

function hasCompatibleModel(select) {
    return Array.from(select?.options || []).some((option) => String(option.value || "").trim());
}

function render(select) {
    const note = select?.parentElement?.querySelector?.('[data-capability="sam_model"]');
    if (!note) return;
    const ready = hasCompatibleModel(select);
    note.hidden = ready;
    note.classList.toggle("bad", !ready);
    note.textContent = ready ? "" : TEXT[language()];
}

function bind(select) {
    if (!select || boundSelects.has(select)) {
        if (select) render(select);
        return;
    }
    boundSelects.add(select);

    const note = document.createElement("div");
    note.className = "mmx-post-capability mmx-post-wide";
    note.dataset.capability = "sam_model";
    select.parentElement?.appendChild(note);

    if (typeof MutationObserver === "function") {
        const observer = new MutationObserver(() => render(select));
        observer.observe(select, { childList: true, subtree: true });
    }
    render(select);
}

function scan() {
    document.querySelectorAll(ROOT_SELECTOR).forEach((root) => bind(root.querySelector(SAM_SELECTOR)));
}

function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    queueMicrotask(() => {
        scanScheduled = false;
        scan();
    });
}

function ensureDocumentObserver() {
    if (documentObserver || typeof MutationObserver !== "function" || !document.body) return;
    documentObserver = new MutationObserver(scheduleScan);
    documentObserver.observe(document.body, { childList: true, subtree: true });
}

function refreshAll() {
    scan();
    document.querySelectorAll(SAM_SELECTOR).forEach(render);
}

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.SAMUI",
    setup() {
        ensureDocumentObserver();
        if (!stopLocaleSync) stopLocaleSync = onLocaleChange(() => queueMicrotask(refreshAll));
        scheduleScan();
    },
    nodeCreated() {
        scheduleScan();
    },
    loadedGraphNode() {
        scheduleScan();
    },
});
