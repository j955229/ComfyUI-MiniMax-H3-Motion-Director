import { shouldCloseEditorBackdrop } from "./minimax_audio_editor_core.mjs";

const BACKDROP_SELECTOR = ".mmx-audio-editor-backdrop";
let activePointerGesture = null;

function closestBackdrop(target) {
    return target?.closest?.(BACKDROP_SELECTOR) || null;
}

document.addEventListener("pointerdown", (event) => {
    const backdrop = closestBackdrop(event.target);
    if (!backdrop) {
        activePointerGesture = null;
        return;
    }
    activePointerGesture = {
        backdrop,
        pointerDownWasBackdrop: event.target === backdrop,
    };
}, true);

document.addEventListener("click", (event) => {
    const backdrop = closestBackdrop(event.target);
    if (!backdrop || activePointerGesture?.backdrop !== backdrop) {
        activePointerGesture = null;
        return;
    }
    const shouldClose = shouldCloseEditorBackdrop(
        activePointerGesture.pointerDownWasBackdrop,
        event.target === backdrop,
    );
    activePointerGesture = null;
    if (event.target === backdrop && !shouldClose) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }
}, true);

document.addEventListener("pointercancel", () => {
    activePointerGesture = null;
}, true);
