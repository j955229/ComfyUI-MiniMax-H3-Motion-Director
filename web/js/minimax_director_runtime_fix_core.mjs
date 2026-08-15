export const GENERATED_AUDIO_CONTINUITY_TASKS = Object.freeze([
    "t2v",
    "i2v",
    "r2v",
    "fl2v",
    "v2v",
    "rv2v",
]);

const GENERATED_AUDIO_CONTINUITY_SET = new Set(
    GENERATED_AUDIO_CONTINUITY_TASKS,
);

export function generatedAudioContinuationShouldBeInteractive(
    taskKey,
    groupCount,
) {
    const task = String(taskKey || "")
        .trim()
        .toLowerCase();

    const count = Math.max(
        0,
        Math.trunc(Number(groupCount) || 0),
    );

    return (
        count > 1
        && GENERATED_AUDIO_CONTINUITY_SET.has(task)
    );
}

function assignOrDelete(target, key, value) {
    if (value === undefined) delete target[key];
    else target[key] = value;
}

export function restoreContinuityWidgetRenderer(widget) {
    const snapshot = widget?._mmxContinuityRendererSnapshot;
    if (!widget || !snapshot) return false;

    let changed = false;
    for (const key of ["type", "draw", "mouse", "onClick", "onPointerDown"]) {
        const before = widget[key];
        const after = snapshot[key];
        if (!Object.is(before, after)) changed = true;
        assignOrDelete(widget, key, after);
    }
    return changed;
}

export function keepSamplingSourceHidden(widget) {
    if (!widget) return false;

    widget.options = widget.options || {};
    const hiddenCompute = widget._mmxRuntimeHiddenCompute
        || (() => [0, 0]);
    widget._mmxRuntimeHiddenCompute = hiddenCompute;

    let changed = widget.hidden !== true
        || widget.options.hidden !== true
        || widget.computeSize !== hiddenCompute
        || (widget.element?.style && widget.element.style.display !== "none");

    widget.hidden = true;
    widget.options.hidden = true;
    widget.computeSize = hiddenCompute;
    if (widget.element?.style) widget.element.style.display = "none";

    // Legacy applySamplingWidgetVisibility() restores this snapshot whenever the
    // locale or sampling state refreshes. Make that owner restore the hidden
    // source widget; the visible controls are the section proxies.
    widget._mmxSamplingVisibility = {
        computeSize: hiddenCompute,
        hidden: true,
        optionHidden: true,
        display: "none",
    };

    return changed;
}

export function scopeTimelineShortcutListener(editor, windowTarget) {
    const handler = editor?._onKeyDown;
    const canvas = editor?.canvas;
    if (!handler || !canvas) return false;

    // Always remove the legacy global capture listener. Calling this repeatedly
    // is intentional in case an editor refresh re-registers it.
    windowTarget?.removeEventListener?.("keydown", handler, true);

    if (editor._mmxRuntimeShortcutScoped === true) return false;
    canvas.addEventListener?.("keydown", handler);
    editor._mmxRuntimeShortcutScoped = true;
    return true;
}

export function releaseTimelineShortcutListener(editor, windowTarget) {
    const handler = editor?._onKeyDown;
    const canvas = editor?.canvas;
    if (!handler) return false;

    windowTarget?.removeEventListener?.("keydown", handler, true);
    canvas?.removeEventListener?.("keydown", handler);
    const changed = editor._mmxRuntimeShortcutScoped === true;
    editor._mmxRuntimeShortcutScoped = false;
    return changed;
}

export function syncDirectorModalAriaState(controller) {
    const shell = controller?.shell;
    if (!shell?.setAttribute) return false;

    const desired = controller.isOpen === true ? "true" : "false";
    const current = shell.getAttribute?.("aria-modal");
    if (current === desired) return false;

    shell.setAttribute("aria-modal", desired);
    return true;
}
