// MiniMax H3 Motion Director — auto-loaded Material Library extension.

import { app } from "../../scripts/app.js";
import { mountMaterialLibrary } from "./minimax_material_library_modal.mjs";

function isDirectorNode(node) {
    const cls = node?.comfyClass || node?.type || "";
    return cls === "MiniMaxH3MotionDirector" || cls === "ComfyMiniMaxH3MotionDirector";
}

function scheduleMount(node) {
    if (!isDirectorNode(node) || node._mmxMaterialLibraryMountPending) return;
    node._mmxMaterialLibraryMountPending = true;
    let attempts = 0;
    const tick = () => {
        attempts += 1;
        const editor = node?._minimaxEditor;
        if (editor?.outputBarEl && editor?._directorModalController?.overlayLayer) {
            mountMaterialLibrary(editor, node);
            node._mmxMaterialLibraryMountPending = false;
            return;
        }
        if (attempts >= 240) {
            node._mmxMaterialLibraryMountPending = false;
            return;
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

function scanGraph() {
    const graph = app.graph || app.canvas?.graph;
    for (const node of graph?._nodes || graph?.nodes || []) if (isDirectorNode(node)) scheduleMount(node);
}

app.registerExtension({
    name: "MiniMaxH3MotionDirector.MaterialLibrary",
    async setup() { scanGraph(); setTimeout(scanGraph, 500); },
    async nodeCreated(node) { scheduleMount(node); },
    async loadedGraphNode(node) { scheduleMount(node); },
});
