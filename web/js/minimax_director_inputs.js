import { app } from "../../scripts/app.js";
import {
    DIRECTOR_ASSETS_BLOCKED_TYPE,
    DIRECTOR_ASSETS_TYPE,
    desiredDirectorInputSockets,
    directorGroupCount,
    externalAssetGroupsFromInputs,
    parseDirectorTimeline,
    resolveDirectorTaskKey,
    timelineGroupHasInternalMedia,
} from "./minimax_director_inputs_core.mjs?boot=unified_inputs_v1";

const DIRECTOR_CLASS = "MiniMaxH3MotionDirector";
const INPUTS_CLASS = "MiniMaxH3MotionDirectorInputs";
const STYLE_ID = "mmx-unified-director-inputs-style";
const SYNC_MS = 250;

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.mmx-external-assets-locked{position:relative!important;box-shadow:inset 0 0 0 1px rgba(79,255,143,.38)!important}
.mmx-external-assets-badge{position:absolute;right:8px;top:8px;z-index:40;pointer-events:none;padding:3px 7px;border:1px solid #4b765b;border-radius:999px;background:rgba(20,50,31,.94);color:#7dffa8;font:10px/1.2 ui-sans-serif,system-ui,sans-serif;white-space:nowrap}
.mmx-external-assets-locked .bd-ref,
.mmx-external-assets-locked .bd-ref-audio,
.mmx-external-assets-locked .bd-r2v-thumb,
.mmx-external-assets-locked .bd-fl2v-slot{filter:saturate(.45);opacity:.58}
`;
    document.head.appendChild(style);
}

function nodeClass(node) {
    return String(node?.comfyClass || node?.type || "");
}

function graphLinkRecord(graph, linkId) {
    if (linkId == null || !graph?.links) return null;
    let link = graph.links[linkId];
    if (!link && typeof graph.links.find === "function") {
        link = graph.links.find((entry) => entry && (entry.id === linkId || entry[0] === linkId));
    }
    if (!link) return null;
    return {
        raw: link,
        originId: link.origin_id ?? link[1],
        originSlot: link.origin_slot ?? link[2],
        targetId: link.target_id ?? link[3],
        targetSlot: link.target_slot ?? link[4],
    };
}

function isPassthroughNode(node) {
    if (!node) return false;
    const cls = nodeClass(node);
    if (/reroute/i.test(cls)) return true;
    if (node.isVirtualNode === true) {
        const linked = (node.inputs || []).filter((input) => input?.link != null);
        return linked.length <= 1;
    }
    return false;
}

function downstreamDirectors(inputsNode) {
    const graph = inputsNode?.graph || app.graph || app.canvas?.graph;
    if (!graph) return [];

    const queue = [];
    for (const output of inputsNode.outputs || []) {
        for (const linkId of output?.links || []) queue.push(linkId);
    }

    const visitedLinks = new Set();
    const directors = new Map();

    while (queue.length) {
        const linkId = queue.shift();
        if (linkId == null || visitedLinks.has(linkId)) continue;
        visitedLinks.add(linkId);
        const record = graphLinkRecord(graph, linkId);
        if (!record) continue;
        const target = graph.getNodeById?.(record.targetId);
        if (!target) continue;

        if (nodeClass(target) === DIRECTOR_CLASS) {
            const input = target.inputs?.[record.targetSlot];
            if (input?.name === "director_inputs") directors.set(target.id, target);
            continue;
        }

        if (!isPassthroughNode(target)) continue;
        for (const output of target.outputs || []) {
            for (const nextLink of output?.links || []) queue.push(nextLink);
        }
    }

    return [...directors.values()];
}

function directorWidgetValue(director, name) {
    return director?.widgets?.find((widget) => widget?.name === name)?.value;
}

function directorMode(director) {
    const editorMode = director?._minimaxEditor?.getTaskKey?.();
    return resolveDirectorTaskKey(editorMode || directorWidgetValue(director, "task_type"));
}

function directorTimeline(director) {
    const live = director?._minimaxEditor?.timeline;
    if (live && typeof live === "object") return live;
    return parseDirectorTimeline(directorWidgetValue(director, "timeline_data"));
}

function desiredShapeMatches(node, desired) {
    const inputs = node?.inputs || [];
    if (inputs.length !== desired.length) return false;
    return desired.every((spec, index) => inputs[index]?.name === spec.name);
}

function disconnectAndRemoveAllInputs(node) {
    if (!node?.inputs?.length) return;
    for (let index = node.inputs.length - 1; index >= 0; index -= 1) {
        if (node.inputs[index]?.link != null) node.disconnectInput?.(index);
        node.removeInput?.(index);
    }
}

function syncInputShape(node, desired) {
    if (!desiredShapeMatches(node, desired)) {
        const existingNames = (node.inputs || []).map((input) => input?.name);
        const desiredNames = desired.map((spec) => spec.name);

        // Group-count changes append/remove sockets and should preserve existing
        // links.  A mode change renames the whole contract, so disconnect the
        // old mode rather than silently reinterpreting a cable as another type.
        const common = Math.min(existingNames.length, desiredNames.length);
        const sharedPrefix = Array.from({ length: common }, (_, index) => index)
            .every((index) => existingNames[index] === desiredNames[index]);

        if (!sharedPrefix) {
            disconnectAndRemoveAllInputs(node);
        } else {
            while ((node.inputs?.length || 0) > desired.length) {
                const index = node.inputs.length - 1;
                if (node.inputs[index]?.link != null) node.disconnectInput?.(index);
                node.removeInput?.(index);
            }
        }

        while ((node.inputs?.length || 0) < desired.length) {
            const spec = desired[node.inputs.length];
            node.addInput?.(spec.name, spec.type);
        }
    }
}

function resizeInputsNode(node) {
    const computed = node.computeSize?.();
    if (!computed) return;
    node.setSize?.([
        Math.max(330, Number(node.size?.[0]) || Number(computed[0]) || 330),
        Number(computed[1]) || Number(node.size?.[1]) || 100,
    ]);
    node.setDirtyCanvas?.(true, true);
}

function clearLockBadges(root) {
    root?.querySelectorAll?.(".mmx-external-assets-locked")?.forEach((card) => {
        card.classList.remove("mmx-external-assets-locked");
        card.querySelector?.(":scope > .mmx-external-assets-badge")?.remove?.();
    });
}

function addLockBadge(card) {
    if (!card || card.querySelector?.(":scope > .mmx-external-assets-badge")) return;
    const badge = document.createElement("div");
    badge.className = "mmx-external-assets-badge";
    badge.textContent = "External Assets · 外部素材";
    card.appendChild(badge);
}

function applyExternalAssetLocks(director, oneBasedGroups) {
    const groups = new Set([...oneBasedGroups].map((value) => Number(value)).filter((value) => value > 0));
    director._mmxExternalAssetLocks = groups;

    const editor = director?._minimaxEditor;
    const root = editor?.container || editor?.root;
    if (!root?.querySelectorAll) return;

    clearLockBadges(root);

    for (const card of root.querySelectorAll(".bd-batch-card[data-segment-index]")) {
        const group = Number(card.dataset.segmentIndex) + 1;
        if (!groups.has(group)) continue;
        card.classList.add("mmx-external-assets-locked");
        addLockBadge(card);
    }

    for (const card of root.querySelectorAll(".bd-fl2v-shot[data-shot-index]")) {
        const group = Number(card.dataset.shotIndex) + 1;
        if (!groups.has(group)) continue;
        card.classList.add("mmx-external-assets-locked");
        addLockBadge(card);
    }
}

function syncBlockedAssetSockets(node, director, desired, timeline, mode) {
    for (let index = 0; index < desired.length; index += 1) {
        const spec = desired[index];
        const input = node.inputs?.[index];
        if (!input) continue;

        input.name = spec.name;
        input.label = spec.name;

        if (spec.kind !== "assets") {
            input.type = spec.type;
            continue;
        }

        const internalMedia = timelineGroupHasInternalMedia(timeline, spec.group, mode);
        if (internalMedia && input.link != null) {
            console.warn(
                `[MiniMax H3 Motion Director] Group ${spec.group}: external Assets disconnected because Director internal media already exists.`,
            );
            node.disconnectInput?.(index);
        }

        if (internalMedia) {
            input.type = DIRECTOR_ASSETS_BLOCKED_TYPE;
            input.label = `${spec.name}  [Director 内已有素材]`;
        } else {
            input.type = DIRECTOR_ASSETS_TYPE;
        }
    }

    const externalGroups = externalAssetGroupsFromInputs(node.inputs || []);
    applyExternalAssetLocks(director, externalGroups);
}

function syncInputsNode(node) {
    const directors = downstreamDirectors(node);
    if (!directors.length) return;

    const director = directors[0];
    if (directors.length > 1) {
        console.warn(
            "[MiniMax H3 Motion Director] One Director Inputs node is connected to multiple Directors; the first Director controls its dynamic sockets.",
        );
    }

    const mode = directorMode(director);
    const timeline = directorTimeline(director);
    const count = directorGroupCount(timeline, mode);
    const desired = desiredDirectorInputSockets(mode, count);

    syncInputShape(node, desired);
    syncBlockedAssetSockets(node, director, desired, timeline, mode);

    node._mmxBoundDirectorId = director.id;
    node._mmxDirectorMode = mode;
    node._mmxDirectorGroupCount = count;
    resizeInputsNode(node);
}

function scheduleSync(node, delay = 0) {
    clearTimeout(node?._mmxInputsSyncTimeout);
    if (!node) return;
    node._mmxInputsSyncTimeout = setTimeout(() => {
        node._mmxInputsSyncTimeout = null;
        syncInputsNode(node);
    }, delay);
}

function targetInsideLockedMedia(target) {
    const element = target?.nodeType === 3 ? target.parentElement : target;
    if (!element?.closest) return false;
    const card = element.closest(".mmx-external-assets-locked");
    if (!card) return false;

    if (card.classList.contains("bd-fl2v-shot")) {
        return !!element.closest(".bd-fl2v-slots, .bd-fl2v-slot-wrap, .bd-fl2v-slot");
    }

    if (card.classList.contains("bd-batch-card")) {
        if (element.closest(".bd-batch-prompts")) return false;
        if (element.closest(".bd-batch-head")) return false;
        if (element.closest(".bd-context-link-row")) return false;
        if (element.closest("[data-batch-sec-index]")) return false;
        if (element.closest('input[type="number"]')) return false;
        return true;
    }

    return false;
}

function blockLockedMediaEvent(event) {
    if (!targetInsideLockedMedia(event.target)) return;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
}

function installLockedMediaGuard() {
    if (window._mmxUnifiedInputsMediaGuard) return;
    window._mmxUnifiedInputsMediaGuard = true;
    for (const type of ["pointerdown", "click", "dblclick", "dragstart", "dragover", "drop"]) {
        document.addEventListener(type, blockLockedMediaEvent, true);
    }
}

ensureStyles();
installLockedMediaGuard();

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.UnifiedInputs",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== INPUTS_CLASS) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            this._mmxInputsPoll = setInterval(() => syncInputsNode(this), SYNC_MS);
            scheduleSync(this, 0);
            return result;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = onConfigure?.apply(this, arguments);
            scheduleSync(this, 80);
            return result;
        };

        const onConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function () {
            const result = onConnectionsChange?.apply(this, arguments);
            scheduleSync(this, 0);
            return result;
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            clearInterval(this._mmxInputsPoll);
            clearTimeout(this._mmxInputsSyncTimeout);
            this._mmxInputsPoll = null;
            this._mmxInputsSyncTimeout = null;
            return onRemoved?.apply(this, arguments);
        };
    },
});
