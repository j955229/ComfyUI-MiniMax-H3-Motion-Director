import {
    createDefaultMixedTimeline,
    mountMixedUI as mountMixedUIV2,
    parseOrCreateMixedTimeline,
    syncMixedGlobalsFromWidgets,
} from "./minimax_mixed_ui_v2.mjs?boot=mixed_native_v7";
import { getLocale } from "./minimax_i18n.js";
import {
    autoScrollDelta,
    moveSegmentById,
    selectedIdsFromTimeline,
    selectionIndicesForIds,
    toggleSelectedId,
} from "./minimax_mixed_interactions.mjs?boot=issue16_v1";

export {
    createDefaultMixedTimeline,
    parseOrCreateMixedTimeline,
    syncMixedGlobalsFromWidgets,
};

const guardedEditors = new WeakSet();
const INTERACTION_STYLE_ID = "mmx-mixed-issue16-interactions";

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

function cloneState(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function dragLabel() {
    return getLocale() === "en" ? "Drag to reorder" : "拖动排序";
}

function ensureInteractionStyles() {
    if (document.getElementById(INTERACTION_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = INTERACTION_STYLE_ID;
    style.textContent = `
.mmx-mixed-drag-handle{flex:0 0 auto;width:24px;height:24px;padding:0;border:1px solid #444;border-radius:4px;background:#181818;color:#aaa;cursor:grab;line-height:1;font-size:15px;display:inline-flex;align-items:center;justify-content:center;user-select:none}
.mmx-mixed-drag-handle:hover{border-color:#777;color:#ddd}.mmx-mixed-drag-handle:active{cursor:grabbing}.mmx-mixed-card.mmx-dragging{opacity:.55}.mmx-mixed-card.mmx-drop-before::before,.mmx-mixed-card.mmx-drop-after::after{content:"";position:absolute;top:2px;bottom:2px;width:3px;background:#4fff8f;z-index:5;border-radius:2px}.mmx-mixed-card.mmx-drop-before::before{left:-2px}.mmx-mixed-card.mmx-drop-after::after{right:-2px}
`;
    document.head.appendChild(style);
}

function installIssue16Interactions(controller, options, selectionState) {
    const root = controller.root;
    let stripScrollLeft = 0;
    let dragId = "";
    let dragTargetIndex = -1;
    let dragSlot = -1;
    let enhancing = false;

    const clearDropMarkers = () => {
        root.querySelectorAll?.(".mmx-mixed-card").forEach((card) => {
            card.classList.remove("mmx-dragging", "mmx-drop-before", "mmx-drop-after");
        });
    };

    const cardIdAt = (index) => String(controller.state?.segments?.[index]?.id || "");

    const enhance = () => {
        if (enhancing || !root.isConnected) return;
        enhancing = true;
        try {
            const strip = root.querySelector(".mmx-mixed-cards");
            if (!strip) return;
            strip.scrollLeft = stripScrollLeft;

            root.querySelectorAll('[data-mmx-action^="move-left-"], [data-mmx-action^="move-right-"]').forEach((button) => button.remove());

            const cards = [...strip.querySelectorAll(".mmx-mixed-card")];
            cards.forEach((card, index) => {
                const segmentId = cardIdAt(index);
                card.dataset.mmxSegmentId = segmentId;
                const head = card.querySelector(".mmx-mixed-card-head");
                if (!head || head.querySelector(".mmx-mixed-drag-handle")) return;

                const handle = document.createElement("button");
                handle.type = "button";
                handle.className = "mmx-mixed-drag-handle";
                handle.draggable = true;
                handle.textContent = "⠿";
                handle.title = dragLabel();
                handle.setAttribute("aria-label", dragLabel());
                handle.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                });
                handle.addEventListener("dragstart", (event) => {
                    dragId = segmentId;
                    dragTargetIndex = index;
                    dragSlot = index;
                    card.classList.add("mmx-dragging");
                    if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", segmentId);
                    }
                    event.stopPropagation();
                });
                handle.addEventListener("dragend", () => {
                    dragId = "";
                    dragTargetIndex = -1;
                    dragSlot = -1;
                    clearDropMarkers();
                });
                head.insertBefore(handle, head.firstChild);
            });
        } finally {
            enhancing = false;
        }
    };

    root.addEventListener("scroll", (event) => {
        const strip = event.target?.closest?.(".mmx-mixed-cards");
        if (strip) stripScrollLeft = strip.scrollLeft;
    }, true);

    root.addEventListener("change", (event) => {
        const target = event.target;
        if (!target || target.tagName !== "INPUT" || target.type !== "checkbox") return;
        if (target.closest(".mmx-mixed-toggle")) {
            selectionState.modeEnabled = !!target.checked;
            selectionState.ids = new Set();
            return;
        }
        const card = target.closest(".mmx-mixed-card");
        if (!card || !target.closest(".mmx-mixed-card-head")) return;
        const id = String(card.dataset.mmxSegmentId || "");
        selectionState.ids = toggleSelectedId(selectionState.ids, id, target.checked);
    }, true);

    root.addEventListener("dragover", (event) => {
        if (!dragId) return;
        const strip = root.querySelector(".mmx-mixed-cards");
        if (!strip) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

        const delta = autoScrollDelta(event.clientX, strip.getBoundingClientRect());
        if (delta) {
            strip.scrollLeft += delta;
            stripScrollLeft = strip.scrollLeft;
        }

        const cards = [...strip.querySelectorAll(".mmx-mixed-card")];
        if (!cards.length) return;
        let slot = cards.length;
        for (let index = 0; index < cards.length; index += 1) {
            const rect = cards[index].getBoundingClientRect();
            if (event.clientX < rect.left + rect.width / 2) {
                slot = index;
                break;
            }
        }

        const fromIndex = controller.state.segments.findIndex((segment) => String(segment?.id || "") === dragId);
        let targetIndex = slot;
        if (fromIndex >= 0 && fromIndex < slot) targetIndex -= 1;
        targetIndex = Math.max(0, Math.min(targetIndex, cards.length - 1));
        dragTargetIndex = targetIndex;
        dragSlot = slot;

        clearDropMarkers();
        const dragging = cards.find((card) => card.dataset.mmxSegmentId === dragId);
        dragging?.classList.add("mmx-dragging");
        if (slot >= cards.length) cards[cards.length - 1]?.classList.add("mmx-drop-after");
        else cards[slot]?.classList.add("mmx-drop-before");
    });

    root.addEventListener("drop", (event) => {
        if (!dragId || dragTargetIndex < 0) return;
        event.preventDefault();
        const selectedSegmentId = String(controller.state?.segments?.[controller.selectedIndex]?.id || "");
        const before = controller.state.segments;
        const after = moveSegmentById(before, dragId, dragTargetIndex);
        const changed = after.some((segment, index) => segment !== before[index]);
        clearDropMarkers();
        dragId = "";
        dragSlot = -1;
        if (!changed) {
            dragTargetIndex = -1;
            return;
        }

        controller.state.segments = after;
        controller.state.runSelection = selectionState.modeEnabled
            ? selectionIndicesForIds(after, selectionState.ids)
            : [];
        dragTargetIndex = -1;
        controller.commitExternalMutation();
        enhance();

        if (selectedSegmentId) {
            const selectedCard = [...root.querySelectorAll(".mmx-mixed-card")].find(
                (card) => String(card.dataset.mmxSegmentId || "") === selectedSegmentId,
            );
            selectedCard?.click();
        }
        queueMicrotask(enhance);
    });

    const Observer = root.ownerDocument?.defaultView?.MutationObserver || globalThis.MutationObserver;
    const observer = Observer ? new Observer(() => queueMicrotask(enhance)) : null;
    observer?.observe(root, { childList: true, subtree: true });
    enhance();

    return {
        refresh: enhance,
        destroy() { observer?.disconnect(); },
    };
}

export function mountMixedUI(options) {
    installMixedExitSplitGuard(options?.editor);
    ensureInteractionStyles();

    const initial = options?.initialState || {};
    const selectionState = {
        modeEnabled: !!initial.runSelectEnabled,
        ids: selectedIdsFromTimeline(initial),
    };
    let controller = null;
    const originalOnChange = options?.onChange;

    const onChange = (nextState) => {
        const corrected = cloneState(nextState || {});
        selectionState.modeEnabled = !!corrected.runSelectEnabled;
        if (!selectionState.modeEnabled) selectionState.ids = new Set();
        corrected.runSelection = selectionState.modeEnabled
            ? selectionIndicesForIds(corrected.segments || [], selectionState.ids)
            : [];
        if (controller) {
            controller.state.runSelectEnabled = selectionState.modeEnabled;
            controller.state.runSelection = [...corrected.runSelection];
        }
        originalOnChange?.(corrected);
    };

    controller = mountMixedUIV2({ ...options, onChange });

    controller.state.runSelectEnabled = selectionState.modeEnabled;
    controller.state.runSelection = selectionState.modeEnabled
        ? selectionIndicesForIds(controller.state.segments || [], selectionState.ids)
        : [];

    const interactions = installIssue16Interactions(controller, options, selectionState);
    const rawSetState = controller.setState.bind(controller);
    controller.setState = (next) => {
        selectionState.modeEnabled = !!next?.runSelectEnabled;
        selectionState.ids = selectedIdsFromTimeline(next || {});
        rawSetState(next);
        controller.state.runSelectEnabled = selectionState.modeEnabled;
        controller.state.runSelection = selectionState.modeEnabled
            ? selectionIndicesForIds(controller.state.segments || [], selectionState.ids)
            : [];
        controller.root.querySelectorAll(".mmx-mixed-card-head input[type=checkbox]").forEach((checkbox, index) => {
            checkbox.checked = controller.state.runSelection.includes(index);
        });
        interactions.refresh();
    };

    const rawDestroy = controller.destroy.bind(controller);
    controller.destroy = () => {
        interactions.destroy();
        rawDestroy();
    };
    return controller;
}
