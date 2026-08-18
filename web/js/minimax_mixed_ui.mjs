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

function syncStandaloneSplitPointUI(editor) {
    editor?.updateSplitPointUI?.();

    const unsupported = editor?.isFl2vMode?.()
        || editor?.isImageBatch?.()
        || editor?.isGenMode?.();
    if (!unsupported) return;

    const bar = editor?.splitEditBarEl
        || editor?.root?.querySelector?.('[data-r="split-edit-bar"]');
    const btn = editor?.root?.querySelector?.('[data-a="del-split"]');
    bar?.classList?.add("hidden");
    if (btn) {
        btn.disabled = true;
        btn.title = "";
    }
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
