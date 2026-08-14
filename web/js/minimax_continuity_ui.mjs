// Pure state rules for the Director node's cross-segment continuity controls.
// Kept DOM-free so workflow compatibility rules can be tested with Node.js.

export const SOURCE_BRIDGE_FIXED_FRAMES = 5;

export const VIDEO_CONTINUITY_STRATEGIES = Object.freeze({
    SOURCE_BRIDGE: "source_bridge",
    MOTION_CONTEXT: "motion_context",
    OFF: "off",
});

export const DIRECTOR_STATE_COLORS = Object.freeze({
    accent: "#4fff8f",
    activeBackground: "#163723",
    neutralBackground: "#252525",
    neutralBorder: "#555555",
    disabled: "#777777",
    danger: "#ef6b6b",
    warning: "#f0b85a",
});

const BRIDGE_TASKS = new Set(["v2v", "rv2v"]);
const MOTION_CONTEXT_TASKS = new Set(["t2v", "i2v", "r2v", "fl2v"]);
const VISUAL_MOTION_CONTEXT_TASKS = new Set(["t2v", "i2v", "r2v", "fl2v", "v2v", "rv2v"]);

function boolValue(value) {
    if (value === false || value === 0 || value == null) return false;
    const text = String(value).trim().toLowerCase();
    return text !== "" && text !== "0" && text !== "false" && text !== "off";
}

export function normalizeSourceBridgeValue(value) {
    return boolValue(value) ? SOURCE_BRIDGE_FIXED_FRAMES : 0;
}

export function resolveH3SpatialStride({
    taskKey,
    segmentCount = 1,
    motionContextEnabled = false,
    hasReferenceVideo = false,
    sourceBridgeValue = 0,
} = {}) {
    void taskKey;
    void segmentCount;
    void motionContextEnabled;
    void hasReferenceVideo;
    void sourceBridgeValue;
    return 32;
}

export function videoStrategyBackendPatch(strategy) {
    if (strategy === VIDEO_CONTINUITY_STRATEGIES.SOURCE_BRIDGE) {
        return { sourceOverlapFrames: SOURCE_BRIDGE_FIXED_FRAMES };
    }
    if (strategy === VIDEO_CONTINUITY_STRATEGIES.MOTION_CONTEXT) {
        return { sourceOverlapFrames: 0, motionContextEnabled: true };
    }
    if (strategy === VIDEO_CONTINUITY_STRATEGIES.OFF) {
        return { sourceOverlapFrames: 0, motionContextEnabled: false };
    }
    throw new RangeError(`Unknown V2V/RV2V continuity strategy: ${strategy}`);
}

export function setWidgetVisibility(widget, visible) {
    if (!widget) return;
    if (!widget._mmxContinuityVisibilitySnapshot) {
        widget._mmxContinuityVisibilitySnapshot = {
            computeSize: widget.computeSize,
            hidden: widget.hidden,
            optionHidden: widget.options?.hidden,
            elementDisplay: widget.element?.style?.display,
        };
    }
    const snapshot = widget._mmxContinuityVisibilitySnapshot;
    widget.options = widget.options || {};
    widget.hidden = !visible;
    widget.options.hidden = !visible;
    if (visible) {
        if (snapshot.computeSize === undefined) delete widget.computeSize;
        else widget.computeSize = snapshot.computeSize;
        if (widget.element?.style) widget.element.style.display = snapshot.elementDisplay ?? "";
    } else {
        widget.computeSize = () => [0, 0];
        if (widget.element?.style) widget.element.style.display = "none";
    }
}

function setInputSpecTooltip(spec, tooltip) {
    if (!spec) return;
    if (Array.isArray(spec)) {
        if (spec[1] && typeof spec[1] === "object") spec[1].tooltip = tooltip;
        return;
    }
    if (typeof spec === "object") spec.tooltip = tooltip;
}

export function setNodeInputTooltip(nodeData, inputName, tooltip) {
    if (!nodeData || !inputName) return;
    const input = nodeData.input;
    for (const section of [input?.required, input?.optional, input?.hidden]) {
        setInputSpecTooltip(section?.[inputName], tooltip);
    }
    if (Array.isArray(nodeData.inputs)) {
        const spec = nodeData.inputs.find((entry) => entry?.name === inputName);
        setInputSpecTooltip(spec, tooltip);
    }
}

export function setWidgetTooltip(widget, tooltip, node) {
    if (!widget) return;
    widget.options = widget.options || {};
    widget.tooltip = tooltip;
    widget.options.tooltip = tooltip;
    setInputSpecTooltip(widget.inputData, tooltip);
    setInputSpecTooltip(widget.input_data, tooltip);

    const nodeData = node?.constructor?.nodeData || node?.nodeData;
    setNodeInputTooltip(nodeData, widget.name, tooltip);
}

export function syncDisabledWidgetState(widget, enabled) {
    if (!widget) return;
    if (!enabled) widget._mmxContinuityStoredValue = widget.value;
    widget._mmxContinuityDisabled = !enabled;
    widget.disabled = !enabled;
}

export function restoreDisabledWidgetValue(widget) {
    if (!widget || widget._mmxContinuityStoredValue === undefined) return;
    widget.value = widget._mmxContinuityStoredValue;
}

export function handleDisabledWidgetCallback(widget, {
    configuring = false,
} = {}) {
    if (!widget?._mmxContinuityDisabled) return "allow";
    if (configuring) {
        // onConfigure is loading the workflow's authoritative serialized value.
        widget._mmxContinuityStoredValue = widget.value;
        return "allow";
    }
    restoreDisabledWidgetValue(widget);
    return "block";
}

export function notifyWidgetValueChange(node, widget, nextValue, callbackArgs = []) {
    if (!widget || Object.is(widget.value, nextValue)) return false;
    const oldValue = widget.value;
    widget.value = nextValue;
    widget.callback?.call(widget, nextValue, ...callbackArgs);
    node?.onWidgetChanged?.(widget.name, nextValue, oldValue, widget);
    node?.graph?.incrementVersion?.();
    node?.setDirtyCanvas?.(true, true);
    return true;
}

export function toggleBooleanWidgetValue(node, widget, enabled, callbackArgs = []) {
    if (!enabled || !widget) return false;
    return notifyWidgetValueChange(node, widget, !boolValue(widget.value), callbackArgs);
}

export function applyVideoStrategyToWidgets({
    node,
    sourceWidget,
    motionWidget,
    strategy,
    callbackArgs = [],
} = {}) {
    if (!sourceWidget || !motionWidget) {
        throw new TypeError("V2V/RV2V continuity strategy requires source and motion widgets.");
    }
    const patch = videoStrategyBackendPatch(strategy);
    const changed = [];
    if (patch.sourceOverlapFrames !== undefined
        && notifyWidgetValueChange(node, sourceWidget, patch.sourceOverlapFrames, callbackArgs)) {
        changed.push(sourceWidget.name);
    }
    if (patch.motionContextEnabled !== undefined
        && notifyWidgetValueChange(node, motionWidget, patch.motionContextEnabled, callbackArgs)) {
        changed.push(motionWidget.name);
    }
    return changed;
}

export function migrateColorReanchorWidgetValues(serializedNode, currentWidgets = []) {
    const values = serializedNode?.widgets_values;
    if (!Array.isArray(values) || !Array.isArray(currentWidgets)) return false;
    const serializable = currentWidgets.filter(
        (widget) => widget?.serialize !== false,
    );
    const colorIndex = serializable.findIndex(
        (widget) => widget?.name === "color_reanchor_enabled",
    );
    if (colorIndex < 0 || colorIndex >= values.length) return false;
    // BOOLEAN widgets serialize as true/false. In legacy workflows the value
    // at this new slot belongs to the following group/steps widget instead.
    if (typeof values[colorIndex] === "boolean") return false;
    values.splice(colorIndex, 0, false);
    return true;
}

export function resolveContinuityUiState({
    taskKey,
    segmentCount,
    motionContextEnabled,
    sourceBridgeValue,
    audioMode,
    colorReanchorEnabled,
} = {}) {
    const task = String(taskKey || "").trim().toLowerCase();
    const segments = Math.max(0, Math.trunc(Number(segmentCount) || 0));
    const multiSegment = segments > 1;
    const bridgeTask = BRIDGE_TASKS.has(task);
    const motionTask = MOTION_CONTEXT_TASKS.has(task);
    const normalizedBridge = normalizeSourceBridgeValue(sourceBridgeValue);
    const bridgeOn = normalizedBridge > 0;
    const motionOn = boolValue(motionContextEnabled);
    const videoStrategy = bridgeTask
        ? (bridgeOn
            ? VIDEO_CONTINUITY_STRATEGIES.SOURCE_BRIDGE
            : motionOn
                ? VIDEO_CONTINUITY_STRATEGIES.MOTION_CONTEXT
                : VIDEO_CONTINUITY_STRATEGIES.OFF)
        : null;

    let mode = "unsupported";
    if (!multiSegment) mode = "single";
    else if (motionTask) mode = "motion_context_task";
    else if (bridgeTask) mode = "video_strategy";

    const generatedMotionUi = mode === "motion_context_task";
    const videoMotionUi = mode === "video_strategy"
        && videoStrategy === VIDEO_CONTINUITY_STRATEGIES.MOTION_CONTEXT;
    const motionActive = (generatedMotionUi && motionOn) || videoMotionUi;
    const supportedVisualTask = VISUAL_MOTION_CONTEXT_TASKS.has(task);
    const showColorReanchor = multiSegment && supportedVisualTask;
    const showContextFrames = generatedMotionUi || videoMotionUi;
    const showAudioContinuation = multiSegment && supportedVisualTask;
    const audioContinuationActive = showAudioContinuation
        && String(audioMode || "generate").toLowerCase() === "generate";

    return {
        taskKey: task,
        segmentCount: segments,
        multiSegment,
        mode,
        videoStrategy,
        sourceBridgeValue: normalizedBridge,
        showSingleSegmentMessage: mode === "single",
        showMotionContext: generatedMotionUi,
        showContextFrames,
        showAudioContinuation,
        showVisualContinuitySelector: mode === "video_strategy",
        showBridgeLength: false,
        showColorReanchor,
        motionContextControlEnabled: generatedMotionUi,
        contextFramesControlEnabled: motionActive,
        audioContextControlEnabled: audioContinuationActive,
        colorReanchorControlEnabled: showColorReanchor && motionActive,
        colorReanchorEnabled: boolValue(colorReanchorEnabled),
        pinRenormControlEnabled: multiSegment && supportedVisualTask && motionActive,
    };
}
