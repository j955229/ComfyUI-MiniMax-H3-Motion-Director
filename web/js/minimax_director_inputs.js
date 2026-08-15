import { app } from "../../scripts/app.js";
import {
    DIRECTOR_ASSETS_BLOCKED_TYPE,
    DIRECTOR_ASSETS_TYPE,
    DIRECTOR_IMAGE_BLOCKED_TYPE,
    DIRECTOR_PROMPT_BLOCKED_TYPE,
    desiredAssetSockets,
    desiredDirectorInputSockets,
    directorGroupCount,
    externalMediaGroupsFromInputs,
    externalPromptGroupsFromInputs,
    parseDirectorTimeline,
    resolveDirectorTaskKey,
    timelineGroupHasInternalMedia,
    timelineGroupHasInternalPrompt,
} from "./minimax_director_inputs_core.mjs?boot=unified_inputs_v2";

const DIRECTOR_CLASS = "MiniMaxH3MotionDirector";
const INPUTS_CLASS = "MiniMaxH3MotionDirectorInputs";
const ASSETS_CLASS = "MiniMaxH3MotionDirectorAssets";
const STYLE_ID = "mmx-unified-director-inputs-style";
const SYNC_MS = 250;
const LEGACY_DIRECTOR_INPUTS = new Set(["i2v_groups", "r2v_groups"]);

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.mmx-external-media-locked{position:relative!important;box-shadow:inset 0 0 0 1px rgba(79,255,143,.38)!important}
.mmx-external-prompt-locked{position:relative!important}
.mmx-external-lock-badge{position:absolute;right:8px;top:8px;z-index:40;pointer-events:none;padding:3px 7px;border:1px solid #4b765b;border-radius:999px;background:rgba(20,50,31,.94);color:#7dffa8;font:10px/1.2 ui-sans-serif,system-ui,sans-serif;white-space:nowrap}
.mmx-external-prompt-badge{top:31px;border-color:#536b8a;background:rgba(25,39,58,.94);color:#9dcbff}
.mmx-external-media-locked .bd-ref,
.mmx-external-media-locked .bd-ref-audio,
.mmx-external-media-locked .bd-r2v-thumb,
.mmx-external-media-locked .bd-fl2v-slot{filter:saturate(.45);opacity:.58}
.mmx-external-prompt-locked .bd-batch-prompts textarea{opacity:.48;cursor:not-allowed}
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

function walkDownstream(startNode, accept) {
    const graph = startNode?.graph || app.graph || app.canvas?.graph;
    if (!graph) return [];
    const queue = [];
    for (const output of startNode.outputs || []) {
        for (const linkId of output?.links || []) queue.push(linkId);
    }
    const visitedLinks = new Set();
    const found = [];
    while (queue.length) {
        const linkId = queue.shift();
        if (linkId == null || visitedLinks.has(linkId)) continue;
        visitedLinks.add(linkId);
        const record = graphLinkRecord(graph, linkId);
        if (!record) continue;
        const target = graph.getNodeById?.(record.targetId);
        if (!target) continue;
        const accepted = accept(target, record);
        if (accepted) {
            found.push(accepted);
            continue;
        }
        if (!isPassthroughNode(target)) continue;
        for (const output of target.outputs || []) {
            for (const nextLink of output?.links || []) queue.push(nextLink);
        }
    }
    return found;
}

function downstreamDirectors(inputsNode) {
    return walkDownstream(inputsNode, (target, record) => {
        if (nodeClass(target) !== DIRECTOR_CLASS) return null;
        const input = target.inputs?.[record.targetSlot];
        return input?.name === "director_inputs" ? target : null;
    });
}

function downstreamAssetTargets(assetNode) {
    return walkDownstream(assetNode, (target, record) => {
        if (nodeClass(target) !== INPUTS_CLASS) return null;
        const input = target.inputs?.[record.targetSlot];
        const name = String(input?.name || "");
        const match = name.match(/^(fl|ref|rv)_assets_([1-9][0-9]*)$/);
        if (!match) return null;
        const mode = { fl: "fl2v", ref: "r2v", rv: "rv2v" }[match[1]];
        return { inputsNode: target, inputName: name, mode, group: Number(match[2]) };
    });
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

function stripLegacyDirectorInputs(node) {
    if (!node?.inputs?.length) return false;
    let changed = false;
    for (let index = node.inputs.length - 1; index >= 0; index -= 1) {
        if (!LEGACY_DIRECTOR_INPUTS.has(String(node.inputs[index]?.name || ""))) continue;
        if (node.inputs[index]?.link != null) node.disconnectInput?.(index);
        node.removeInput?.(index);
        changed = true;
    }
    if (changed) node.setDirtyCanvas?.(true, true);
    return changed;
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
    if (desiredShapeMatches(node, desired)) return;
    const existingNames = (node.inputs || []).map((input) => input?.name);
    const desiredNames = desired.map((spec) => spec.name);
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

function resizeNode(node, minWidth = 330) {
    const computed = node.computeSize?.();
    if (!computed) return;
    node.setSize?.([
        Math.max(minWidth, Number(node.size?.[0]) || Number(computed[0]) || minWidth),
        Number(computed[1]) || Number(node.size?.[1]) || 100,
    ]);
    node.setDirtyCanvas?.(true, true);
}

function restorePromptElement(element) {
    if (!element || element.dataset?.mmxExternalPromptDisabled !== "1") return;
    element.disabled = false;
    delete element.dataset.mmxExternalPromptDisabled;
}

function disablePromptElement(element) {
    if (!element) return;
    element.disabled = true;
    element.dataset.mmxExternalPromptDisabled = "1";
}

function clearDirectorLocks(director) {
    const editor = director?._minimaxEditor;
    const root = editor?.container || editor?.root;
    root?.querySelectorAll?.(".mmx-external-media-locked, .mmx-external-prompt-locked")?.forEach((card) => {
        card.classList.remove("mmx-external-media-locked", "mmx-external-prompt-locked");
        card.querySelectorAll?.(":scope > .mmx-external-lock-badge")?.forEach((badge) => badge.remove?.());
        card.querySelectorAll?.("textarea[data-mmx-external-prompt-disabled='1']")?.forEach(restorePromptElement);
    });
    restorePromptElement(editor?.fl2vUi?.prompt);
}

function addBadge(card, text, extraClass = "") {
    if (!card) return;
    const badge = document.createElement("div");
    badge.className = `mmx-external-lock-badge ${extraClass}`.trim();
    badge.textContent = text;
    card.appendChild(badge);
}

function applyExternalLocks(director, mediaGroups, promptGroups, mode) {
    const media = new Set([...mediaGroups].map(Number).filter((value) => value > 0));
    const prompts = new Set([...promptGroups].map(Number).filter((value) => value > 0));
    director._mmxExternalMediaLocks = media;
    director._mmxExternalPromptLocks = prompts;

    const editor = director?._minimaxEditor;
    const root = editor?.container || editor?.root;
    if (!root?.querySelectorAll) return;

    clearDirectorLocks(director);

    for (const card of root.querySelectorAll(".bd-batch-card[data-segment-index]")) {
        const group = Number(card.dataset.segmentIndex) + 1;
        if (media.has(group)) {
            card.classList.add("mmx-external-media-locked");
            addBadge(card, "External Media · 外部素材");
        }
        if (prompts.has(group)) {
            card.classList.add("mmx-external-prompt-locked");
            addBadge(card, "External Prompt · 外部提示词", "mmx-external-prompt-badge");
            card.querySelectorAll?.(".bd-batch-prompts textarea")?.forEach(disablePromptElement);
        }
    }

    for (const card of root.querySelectorAll(".bd-fl2v-shot[data-shot-index]")) {
        const group = Number(card.dataset.shotIndex) + 1;
        if (media.has(group)) {
            card.classList.add("mmx-external-media-locked");
            addBadge(card, "External Media · 外部素材");
        }
        if (prompts.has(group)) {
            card.classList.add("mmx-external-prompt-locked");
            addBadge(card, "External Prompt · 外部提示词", "mmx-external-prompt-badge");
        }
    }

    if (resolveDirectorTaskKey(mode) === "fl2v") {
        const selectedGroup = Number(editor?.selectedIndex ?? -1) + 1;
        if (prompts.has(selectedGroup)) disablePromptElement(editor?.fl2vUi?.prompt);
    }
}

function syncBlockedSockets(node, director, desired, timeline, mode) {
    for (let index = 0; index < desired.length; index += 1) {
        const spec = desired[index];
        const input = node.inputs?.[index];
        if (!input) continue;
        input.name = spec.name;
        input.label = spec.name;

        if (spec.kind === "prompt") {
            const internalPrompt = timelineGroupHasInternalPrompt(timeline, spec.group, mode);
            if (internalPrompt && input.link != null) {
                console.warn(`[MiniMax H3 Motion Director] Group ${spec.group}: external prompt disconnected because Director internal prompt already exists.`);
                node.disconnectInput?.(index);
            }
            input.type = internalPrompt ? DIRECTOR_PROMPT_BLOCKED_TYPE : "STRING";
            if (internalPrompt) input.label = `${spec.name}  [Director 内已有提示词]`;
            continue;
        }

        const internalMedia = timelineGroupHasInternalMedia(timeline, spec.group, mode);
        if (internalMedia && input.link != null) {
            console.warn(`[MiniMax H3 Motion Director] Group ${spec.group}: external media disconnected because Director internal media already exists.`);
            node.disconnectInput?.(index);
        }

        if (spec.kind === "image") {
            input.type = internalMedia ? DIRECTOR_IMAGE_BLOCKED_TYPE : "IMAGE";
            if (internalMedia) input.label = `${spec.name}  [Director 内已有图片]`;
        } else {
            input.type = internalMedia ? DIRECTOR_ASSETS_BLOCKED_TYPE : DIRECTOR_ASSETS_TYPE;
            if (internalMedia) input.label = `${spec.name}  [Director 内已有素材]`;
        }
    }

    applyExternalLocks(
        director,
        externalMediaGroupsFromInputs(node.inputs || []),
        externalPromptGroupsFromInputs(node.inputs || []),
        mode,
    );
}

function boundDirector(node) {
    const graph = node?.graph || app.graph || app.canvas?.graph;
    return node?._mmxBoundDirectorId != null
        ? graph?.getNodeById?.(node._mmxBoundDirectorId)
        : null;
}

function cleanupInputsNode(node) {
    const director = boundDirector(node);
    if (director) clearDirectorLocks(director);
    node._mmxBoundDirectorId = null;
}

function syncInputsNode(node) {
    const directors = downstreamDirectors(node);
    if (!directors.length) {
        cleanupInputsNode(node);
        return;
    }
    const director = directors[0];
    stripLegacyDirectorInputs(director);

    const mode = directorMode(director);
    const timeline = directorTimeline(director);
    const count = directorGroupCount(timeline, mode);
    const desired = desiredDirectorInputSockets(mode, count);

    syncInputShape(node, desired);
    syncBlockedSockets(node, director, desired, timeline, mode);

    node._mmxBoundDirectorId = director.id;
    node._mmxDirectorMode = mode;
    node._mmxDirectorGroupCount = count;
    resizeNode(node);
}

function syncAssetsNode(node) {
    const targets = downstreamAssetTargets(node);
    if (!targets.length) return;
    const target = targets[0];
    if (targets.length > 1) {
        console.warn("[MiniMax H3 Motion Director] One Director Assets node is connected to multiple asset sockets; the first socket controls its profile.");
    }
    const mode = target.inputsNode?._mmxDirectorMode || target.mode;
    if (node._mmxAssetMode && node._mmxAssetMode !== mode) {
        disconnectAndRemoveAllInputs(node);
    }
    syncInputShape(node, desiredAssetSockets(mode));
    node._mmxAssetMode = mode;
    node._mmxAssetGroup = target.group;
    resizeNode(node, 300);
}

function scheduleSync(node, fn, delay = 0) {
    clearTimeout(node?._mmxUnifiedSyncTimeout);
    if (!node) return;
    node._mmxUnifiedSyncTimeout = setTimeout(() => {
        node._mmxUnifiedSyncTimeout = null;
        fn(node);
    }, delay);
}

function targetInsideLockedMedia(target) {
    const element = target?.nodeType === 3 ? target.parentElement : target;
    if (!element?.closest) return false;
    const card = element.closest(".mmx-external-media-locked");
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

function wrapDynamicNode(nodeType, syncFn, cleanupFn = null) {
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = onNodeCreated?.apply(this, arguments);
        this._mmxUnifiedPoll = setInterval(() => syncFn(this), SYNC_MS);
        scheduleSync(this, syncFn, 0);
        return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
        const result = onConfigure?.apply(this, arguments);
        scheduleSync(this, syncFn, 80);
        return result;
    };

    const onConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
        const result = onConnectionsChange?.apply(this, arguments);
        scheduleSync(this, syncFn, 0);
        return result;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
        clearInterval(this._mmxUnifiedPoll);
        clearTimeout(this._mmxUnifiedSyncTimeout);
        this._mmxUnifiedPoll = null;
        this._mmxUnifiedSyncTimeout = null;
        cleanupFn?.(this);
        return onRemoved?.apply(this, arguments);
    };
}

function wrapDirectorMigration(nodeType) {
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = onNodeCreated?.apply(this, arguments);
        setTimeout(() => stripLegacyDirectorInputs(this), 0);
        setTimeout(() => stripLegacyDirectorInputs(this), 250);
        return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
        const result = onConfigure?.apply(this, arguments);
        stripLegacyDirectorInputs(this);
        setTimeout(() => stripLegacyDirectorInputs(this), 0);
        setTimeout(() => stripLegacyDirectorInputs(this), 250);
        return result;
    };
}

ensureStyles();
installLockedMediaGuard();

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.UnifiedInputs",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name === DIRECTOR_CLASS) {
            wrapDirectorMigration(nodeType);
            return;
        }
        if (nodeData?.name === INPUTS_CLASS) {
            wrapDynamicNode(nodeType, syncInputsNode, cleanupInputsNode);
            return;
        }
        if (nodeData?.name === ASSETS_CLASS) {
            wrapDynamicNode(nodeType, syncAssetsNode);
        }
    },
});
