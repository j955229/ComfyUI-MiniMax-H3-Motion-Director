const INTERNAL_SAMPLING_WIDGETS = Object.freeze([
    "steps",
    "sampler_name",
    "scheduler",
    "shift_video",
    "shift_audio",
]);

const SEED_CONTROL_MODES = new Set(["fixed", "increment", "decrement", "randomize"]);

export function normalizeSeedControlMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    return SEED_CONTROL_MODES.has(mode) ? mode : "unknown";
}

export function seedControlModeFromWidgets(widgets = []) {
    const seed = widgets.find((widget) => widget?.name === "seed");
    const control = seed?.linkedWidgets?.find((widget) => (
        /control[_\s]?after[_\s]?generate/i.test(String(widget?.name || widget?.label || ""))
    ));
    return normalizeSeedControlMode(control?.value);
}

function hasLink(input) {
    return input?.link !== null && input?.link !== undefined;
}

export function getSamplingConnectionState(inputs = []) {
    const sampler = inputs.find((input) => input?.name === "sampler");
    const sigmas = inputs.find((input) => input?.name === "sigmas");
    const hasSampler = hasLink(sampler);
    const hasSigmas = hasLink(sigmas);
    if (hasSampler && hasSigmas) return "external";
    if (!hasSampler && !hasSigmas) return "internal";
    return "incomplete";
}

function setWidgetVisible(widget, visible) {
    if (!widget) return;
    if (!widget._mmxSamplingVisibility) {
        widget._mmxSamplingVisibility = {
            computeSize: widget.computeSize,
            hidden: widget.hidden,
            optionHidden: widget.options?.hidden,
            display: widget.element?.style?.display ?? "",
        };
    }
    const saved = widget._mmxSamplingVisibility;
    if (visible) {
        widget.computeSize = saved.computeSize;
        widget.hidden = saved.hidden;
        if (!widget.options) widget.options = {};
        if (saved.optionHidden === undefined) delete widget.options.hidden;
        else widget.options.hidden = saved.optionHidden;
        if (widget.element?.style) widget.element.style.display = saved.display;
        return;
    }
    widget.hidden = true;
    if (!widget.options) widget.options = {};
    widget.options.hidden = true;
    widget.computeSize = () => [0, 0];
    if (widget.element?.style) widget.element.style.display = "none";
}

export function applySamplingWidgetVisibility(node) {
    const state = getSamplingConnectionState(node?.inputs || []);
    const showInternal = state !== "external";
    for (const name of INTERNAL_SAMPLING_WIDGETS) {
        setWidgetVisible(node?.widgets?.find((widget) => widget?.name === name), showInternal);
    }
    return state;
}

function widgetIndexBefore(inputs, inputIndex) {
    let index = 0;
    for (let i = 0; i < inputIndex; i += 1) {
        if (inputs[i]?.widget) index += 1;
    }
    return index;
}

export function migrateLegacySamplingControlNode(node) {
    if (!node || node.type !== "MiniMaxH3MotionDirector" || !Array.isArray(node.inputs)) {
        return false;
    }
    const inputIndex = node.inputs.findIndex((input) => input?.name === "sampling_control");
    if (inputIndex < 0) return false;
    const explicitValueIndex = Array.isArray(node.widgets_values)
        ? node.widgets_values.findIndex((value) => value === "internal" || value === "external")
        : -1;
    // ComfyUI serializes seed's linked control_after_generate widget even though
    // it has no matching node.inputs entry, so prefer the distinctive legacy value.
    const widgetIndex = explicitValueIndex >= 0
        ? explicitValueIndex
        : widgetIndexBefore(node.inputs, inputIndex);
    node.inputs.splice(inputIndex, 1);
    if (Array.isArray(node.widgets_values) && widgetIndex < node.widgets_values.length) {
        node.widgets_values.splice(widgetIndex, 1);
    }
    return { inputIndex };
}

export function migrateLegacySamplingControlWorkflow(graphData) {
    if (!graphData || !Array.isArray(graphData.nodes)) return 0;
    const removedSlots = new Map();
    for (const node of graphData.nodes) {
        const result = migrateLegacySamplingControlNode(node);
        if (result) removedSlots.set(String(node.id), result.inputIndex);
    }
    if (!removedSlots.size || !Array.isArray(graphData.links)) return removedSlots.size;

    for (const link of graphData.links) {
        if (Array.isArray(link)) {
            const removed = removedSlots.get(String(link[3]));
            if (removed !== undefined && Number(link[4]) > removed) link[4] -= 1;
            continue;
        }
        if (!link || typeof link !== "object") continue;
        const targetIdKey = "target_id" in link ? "target_id" : "targetId";
        const targetSlotKey = "target_slot" in link ? "target_slot" : "targetSlot";
        const removed = removedSlots.get(String(link[targetIdKey]));
        if (removed !== undefined && Number(link[targetSlotKey]) > removed) {
            link[targetSlotKey] -= 1;
        }
    }
    return removedSlots.size;
}

export { INTERNAL_SAMPLING_WIDGETS };
