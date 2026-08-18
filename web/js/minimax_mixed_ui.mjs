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

export function mountMixedUI(options) {
    const controller = mountMixedUIV2(options);
    const destroyMixedUI = controller?.destroy?.bind(controller);
    if (!destroyMixedUI) return controller;

    let destroyed = false;
    controller.destroy = () => {
        if (destroyed) return;
        destroyed = true;
        destroyMixedUI();

        // _leaveMixedNative() restores the standalone Director bodies after
        // destroying Mixed. Re-apply the target mode's own split-point
        // visibility once that synchronous mode transition has completed.
        queueMicrotask(() => {
            const editor = options?.editor;
            if (editor?.getDirectorMode?.() === "mixed") return;
            editor?.updateSplitPointUI?.();
        });
    };
    return controller;
}
