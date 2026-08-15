import { app } from "../../scripts/app.js";
import {
    staleDirectorOutputIndices,
} from "./minimax_director_outputs_core.mjs?boot=director_outputs_v1";

const DIRECTOR_CLASS = "MiniMaxH3MotionDirector";

function stripStaleDirectorOutputs(node) {
    const stale = staleDirectorOutputIndices(node?.outputs || []);
    if (!stale.length) return false;

    for (const index of stale) {
        try {
            node.disconnectOutput?.(index);
        } catch {
            // removeOutput also severs stale serialized links in normal LiteGraph.
        }
        node.removeOutput?.(index);
    }

    node.setDirtyCanvas?.(true, true);
    return true;
}

function scheduleCleanup(node) {
    stripStaleDirectorOutputs(node);
    setTimeout(() => stripStaleDirectorOutputs(node), 0);
    setTimeout(() => stripStaleDirectorOutputs(node), 250);
}

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.PublicOutputs",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== DIRECTOR_CLASS) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            scheduleCleanup(this);
            return result;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = onConfigure?.apply(this, arguments);
            scheduleCleanup(this);
            return result;
        };
    },
});
