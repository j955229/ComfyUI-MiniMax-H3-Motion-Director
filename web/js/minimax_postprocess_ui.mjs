export * from "./minimax_postprocess_ui_legacy.mjs";

import { mountPostprocessUI as mountLegacyPostprocessUI } from "./minimax_postprocess_ui_legacy.mjs";

const SAM_EMPTY_TEXT = {
    en: "No compatible SAM .pt model found. Put an Ultralytics SAM/SAM2 checkpoint in ComfyUI/models/sams.",
    zh: "未找到兼容的 SAM .pt 模型。请将 Ultralytics SAM/SAM2 checkpoint 放入 ComfyUI/models/sams。",
};

function attachSamEmptyState(mounted, options = {}) {
    const root = mounted?.root;
    const select = root?.querySelector?.('[data-path="face_refine.sam_model"]');
    const host = select?.closest?.('[data-conditional="face_sam_model"]') || select?.parentElement;
    if (!root || !select || !host) return mounted;

    const note = document.createElement("div");
    note.className = "mmx-post-capability mmx-post-wide";
    note.dataset.capability = "sam_model";
    host.appendChild(note);

    const currentLocale = (explicit) => {
        if (explicit === "en") return "en";
        if (explicit === "zh") return "zh";
        return options.locale?.() === "en" ? "en" : "zh";
    };
    const render = (language) => {
        const hasModel = Array.from(select.options || []).some((option) => String(option.value || "").trim());
        note.hidden = hasModel;
        note.classList.toggle("bad", !hasModel);
        note.textContent = hasModel ? "" : SAM_EMPTY_TEXT[currentLocale(language)];
    };

    const observer = new MutationObserver(() => render());
    observer.observe(select, { childList: true, subtree: true });

    const legacyUpdateLocale = mounted.updateLocale?.bind(mounted);
    mounted.updateLocale = (language) => {
        legacyUpdateLocale?.(language);
        render(language);
    };

    const legacyDestroy = mounted.destroy;
    mounted.destroy = () => {
        observer.disconnect();
        legacyDestroy?.();
    };

    render();
    return mounted;
}

export function mountPostprocessUI(container, store, options = {}) {
    return attachSamEmptyState(
        mountLegacyPostprocessUI(container, store, options),
        options,
    );
}
