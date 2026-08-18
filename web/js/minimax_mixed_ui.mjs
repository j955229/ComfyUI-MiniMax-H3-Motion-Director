import {
    createDefaultMixedTimeline,
    mountMixedUI as mountMixedUIV2,
    parseOrCreateMixedTimeline,
    syncMixedGlobalsFromWidgets,
} from "./minimax_mixed_ui_v2.mjs?boot=mixed_native_v7";

export {
    createDefaultMixedTimeline,
    parseOrCreateMixedTimeline,
    syncMixedGlobalsFromWidgets,
};

const guardedEditors = new WeakSet();

export function enforceStandaloneSplitPointVisibility(editor) {
    const unsupported = editor?.isFl2vMode?.()
        || editor?.isImageBatch?.()
        || editor?.isGenMode?.();
    if (!unsupported) return false;

    const bar = editor?.splitEditBarEl
        || editor?.root?.querySelector?.('[data-r="split-edit-bar"]');
    const btn = editor?.root?.querySelector?.('[data-a="del-split"]');
    let changed = false;

    if (bar && !bar.classList?.contains?.("hidden")) {
        bar.classList?.add?.("hidden");
        changed = true;
    }
    if (btn) {
        if (!btn.disabled) changed = true;
        btn.disabled = true;
        btn.title = "";
    }
    return changed;
}

function syncStandaloneSplitPointUI(editor) {
    editor?.updateSplitPointUI?.();
    return enforceStandaloneSplitPointVisibility(editor);
}

function installMixedExitSplitGuard(editor) {
    if (!editor || guardedEditors.has(editor) || typeof editor.applyTaskLayout !== "function") return;

    const applyTaskLayout = editor.applyTaskLayout;
    editor.applyTaskLayout = function (...args) {
        const result = applyTaskLayout.apply(this, args);
        if (this.getDirectorMode?.() !== "mixed") {
            syncStandaloneSplitPointUI(this);
        }
        return result;
    };
    guardedEditors.add(editor);
}

export function mountMixedUI(options) {
    installMixedExitSplitGuard(options?.editor);
    return mountMixedUIV2(options);
}
