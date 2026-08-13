import test from "node:test";
import assert from "node:assert/strict";

import {
    DIRECTOR_STATE_COLORS,
    SOURCE_BRIDGE_FIXED_FRAMES,
    VIDEO_CONTINUITY_STRATEGIES,
    applyVideoStrategyToWidgets,
    handleDisabledWidgetCallback,
    migrateColorReanchorWidgetValues,
    normalizeSourceBridgeValue,
    notifyWidgetValueChange,
    resolveContinuityUiState,
    resolveH3SpatialStride,
    restoreDisabledWidgetValue,
    setNodeInputTooltip,
    setWidgetTooltip,
    setWidgetVisibility,
    syncDisabledWidgetState,
    toggleBooleanWidgetValue,
    videoStrategyBackendPatch,
} from "../web/js/minimax_continuity_ui.mjs";

const state = (overrides = {}) => resolveContinuityUiState({
    taskKey: "t2v",
    segmentCount: 3,
    motionContextEnabled: true,
    contextFrames: 22,
    sourceBridgeValue: 0,
    audioContextEnabled: true,
    colorReanchorEnabled: false,
    audioMode: "generate",
    ...overrides,
});

test("legacy Source Bridge values normalize to INT 0 or fixed 5", () => {
    assert.equal(SOURCE_BRIDGE_FIXED_FRAMES, 5);
    assert.equal(normalizeSourceBridgeValue(0), 0);
    assert.equal(normalizeSourceBridgeValue(false), 0);
    assert.equal(normalizeSourceBridgeValue("off"), 0);
    for (const legacyValue of [1, 3, 5, 22, true, "1"]) {
        assert.equal(normalizeSourceBridgeValue(legacyValue), 5);
    }
});

test("a single segment shows only the multi-segment availability message", () => {
    const actual = state({ taskKey: "rv2v", segmentCount: 1, sourceBridgeValue: 5 });
    assert.equal(actual.mode, "single");
    assert.equal(actual.showSingleSegmentMessage, true);
    assert.equal(actual.showMotionContext, false);
    assert.equal(actual.showContextFrames, false);
    assert.equal(actual.showAudioContinuation, false);
    assert.equal(actual.showVisualContinuitySelector, false);
    assert.equal(actual.showBridgeLength, false);
    assert.equal(actual.showColorReanchor, false);
});

for (const taskKey of ["t2v", "i2v", "r2v", "fl2v"]) {
    test(`${taskKey.toUpperCase()} multi-segment shows only Motion Context controls`, () => {
        const actual = state({ taskKey, sourceBridgeValue: 5 });
        assert.equal(actual.mode, "motion_context_task");
        assert.equal(actual.showSingleSegmentMessage, false);
        assert.equal(actual.showMotionContext, true);
        assert.equal(actual.showContextFrames, true);
        assert.equal(actual.showAudioContinuation, true);
        assert.equal(actual.showVisualContinuitySelector, false);
        assert.equal(actual.showBridgeLength, false);
        assert.equal(actual.videoStrategy, null);
        assert.equal(actual.showColorReanchor, true);
    });
}

for (const taskKey of ["v2v", "rv2v"]) {
    test(`${taskKey.toUpperCase()} legacy non-zero source value selects Source Bridge`, () => {
        const actual = state({ taskKey, sourceBridgeValue: 3, motionContextEnabled: true });
        assert.equal(actual.mode, "video_strategy");
        assert.equal(actual.videoStrategy, VIDEO_CONTINUITY_STRATEGIES.SOURCE_BRIDGE);
        assert.equal(actual.sourceBridgeValue, 5);
        assert.equal(actual.showVisualContinuitySelector, true);
        assert.equal(actual.showBridgeLength, false);
        assert.equal(actual.showMotionContext, false);
        assert.equal(actual.showContextFrames, false);
        assert.equal(actual.showAudioContinuation, true);
        assert.equal(actual.audioContextControlEnabled, true);
        assert.equal(actual.showColorReanchor, true);
        assert.equal(actual.colorReanchorControlEnabled, false);
        assert.equal(actual.pinRenormControlEnabled, false);
    });

    test(`${taskKey.toUpperCase()} source 0 plus Motion Context true selects Motion Context`, () => {
        const actual = state({ taskKey, sourceBridgeValue: 0, motionContextEnabled: true });
        assert.equal(actual.videoStrategy, VIDEO_CONTINUITY_STRATEGIES.MOTION_CONTEXT);
        assert.equal(actual.showVisualContinuitySelector, true);
        assert.equal(actual.showBridgeLength, false);
        assert.equal(actual.showMotionContext, false);
        assert.equal(actual.showContextFrames, true);
        assert.equal(actual.showAudioContinuation, true);
        assert.equal(actual.showColorReanchor, true);
        assert.equal(actual.pinRenormControlEnabled, true);
    });

    test(`${taskKey.toUpperCase()} source 0 plus Motion Context false selects Off`, () => {
        const actual = state({ taskKey, sourceBridgeValue: 0, motionContextEnabled: false });
        assert.equal(actual.videoStrategy, VIDEO_CONTINUITY_STRATEGIES.OFF);
        assert.equal(actual.showVisualContinuitySelector, true);
        assert.equal(actual.showBridgeLength, false);
        assert.equal(actual.showMotionContext, false);
        assert.equal(actual.showContextFrames, false);
        assert.equal(actual.showAudioContinuation, true);
        assert.equal(actual.audioContextControlEnabled, true);
        assert.equal(actual.showColorReanchor, true);
        assert.equal(actual.colorReanchorControlEnabled, false);
        assert.equal(actual.pinRenormControlEnabled, false);
    });
}

test("V2V/RV2V selector maps Source Bridge to source=5 without overwriting saved Motion Context preference", () => {
    assert.deepEqual(
        videoStrategyBackendPatch(VIDEO_CONTINUITY_STRATEGIES.SOURCE_BRIDGE, { motionContextEnabled: true }),
        { sourceOverlapFrames: 5 },
    );
    assert.deepEqual(
        videoStrategyBackendPatch(VIDEO_CONTINUITY_STRATEGIES.SOURCE_BRIDGE, { motionContextEnabled: false }),
        { sourceOverlapFrames: 5 },
    );
});

test("V2V/RV2V selector maps Motion Context to source=0 and motion=true", () => {
    assert.deepEqual(
        videoStrategyBackendPatch(VIDEO_CONTINUITY_STRATEGIES.MOTION_CONTEXT),
        { sourceOverlapFrames: 0, motionContextEnabled: true },
    );
});

test("V2V/RV2V selector maps Off to source=0 and motion=false", () => {
    assert.deepEqual(
        videoStrategyBackendPatch(VIDEO_CONTINUITY_STRATEGIES.OFF),
        { sourceOverlapFrames: 0, motionContextEnabled: false },
    );
});

test("context and audio preferences survive Motion Context to Bridge to Motion Context switching", () => {
    const saved = { contextFrames: 1, audioContextEnabled: true, motionContextEnabled: true };
    Object.assign(saved, videoStrategyBackendPatch(VIDEO_CONTINUITY_STRATEGIES.SOURCE_BRIDGE, saved));
    assert.deepEqual(saved, {
        contextFrames: 1,
        audioContextEnabled: true,
        motionContextEnabled: true,
        sourceOverlapFrames: 5,
    });
    Object.assign(saved, videoStrategyBackendPatch(VIDEO_CONTINUITY_STRATEGIES.MOTION_CONTEXT, saved));
    assert.equal(saved.contextFrames, 1);
    assert.equal(saved.audioContextEnabled, true);
    assert.equal(saved.motionContextEnabled, true);
    assert.equal(saved.sourceOverlapFrames, 0);
});

test("Motion Context OFF keeps dependent controls visible but disabled for generated-continuation tasks", () => {
    const actual = state({ motionContextEnabled: false });
    assert.equal(actual.showMotionContext, true);
    assert.equal(actual.showContextFrames, true);
    assert.equal(actual.showAudioContinuation, true);
    assert.equal(actual.contextFramesControlEnabled, false);
    assert.equal(actual.audioContextControlEnabled, true);
});

for (const taskKey of ["t2v", "i2v", "r2v", "fl2v"]) {
    test(`${taskKey.toUpperCase()} generated-audio continuation requires generate mode`, () => {
        assert.equal(state({ taskKey, audioMode: "generate" }).audioContextControlEnabled, true);
        assert.equal(state({ taskKey, audioMode: "source" }).audioContextControlEnabled, false);
        assert.equal(state({ taskKey, audioMode: "mute" }).audioContextControlEnabled, false);
    });
}

test("I2V generated-audio continuation remains independent from Motion Context", () => {
    const actual = state({
        taskKey: "i2v",
        motionContextEnabled: false,
        audioMode: "generate",
    });
    assert.equal(actual.showAudioContinuation, true);
    assert.equal(actual.audioContextControlEnabled, true);
});

for (const taskKey of ["v2v", "rv2v"]) {
    test(`${taskKey.toUpperCase()} Motion Context audio continuation respects edit audio mode`, () => {
        const base = {
            taskKey,
            sourceBridgeValue: 0,
            motionContextEnabled: true,
        };
        assert.equal(
            state({ ...base, audioMode: "generate" }).audioContextControlEnabled,
            true,
        );
        assert.equal(
            state({ ...base, audioMode: "source" }).audioContextControlEnabled,
            false,
        );
        assert.equal(
            state({ ...base, audioMode: "mute" }).audioContextControlEnabled,
            false,
        );
    });
}

test("unrelated tasks expose no continuity controls", () => {
    const actual = state({ taskKey: "t2i", sourceBridgeValue: 5 });
    assert.equal(actual.mode, "unsupported");
    assert.equal(actual.showMotionContext, false);
    assert.equal(actual.showContextFrames, false);
    assert.equal(actual.showAudioContinuation, false);
    assert.equal(actual.showVisualContinuitySelector, false);
    assert.equal(actual.showBridgeLength, false);
    assert.equal(actual.showColorReanchor, false);
});

test("Color Re-anchor is visible for every multi-segment visual task and disabled off-path", () => {
    for (const taskKey of ["t2v", "i2v", "fl2v", "r2v"]) {
        const enabled = state({ taskKey, motionContextEnabled: true });
        assert.equal(enabled.showColorReanchor, true);
        assert.equal(enabled.colorReanchorControlEnabled, true);
        const disabled = state({ taskKey, motionContextEnabled: false });
        assert.equal(disabled.showColorReanchor, true);
        assert.equal(disabled.colorReanchorControlEnabled, false);
    }
    for (const taskKey of ["v2v", "rv2v"]) {
        assert.equal(state({
            taskKey,
            sourceBridgeValue: 0,
            motionContextEnabled: true,
        }).showColorReanchor, true);
        assert.equal(state({
            taskKey,
            sourceBridgeValue: 5,
            motionContextEnabled: true,
        }).colorReanchorControlEnabled, false);
        assert.equal(state({
            taskKey,
            sourceBridgeValue: 0,
            motionContextEnabled: false,
        }).colorReanchorControlEnabled, false);
    }
    assert.equal(state({ taskKey: "i2v", segmentCount: 1 }).showColorReanchor, false);
});

test("pin_renorm is enabled only when visual Motion Context can actually run", () => {
    for (const taskKey of ["t2v", "i2v", "fl2v", "r2v"]) {
        assert.equal(state({ taskKey, motionContextEnabled: true }).pinRenormControlEnabled, true);
        assert.equal(state({ taskKey, motionContextEnabled: false }).pinRenormControlEnabled, false);
    }
    for (const taskKey of ["v2v", "rv2v"]) {
        assert.equal(state({ taskKey, sourceBridgeValue: 0, motionContextEnabled: true }).pinRenormControlEnabled, true);
        assert.equal(state({ taskKey, sourceBridgeValue: 5 }).pinRenormControlEnabled, false);
        assert.equal(state({ taskKey, sourceBridgeValue: 0, motionContextEnabled: false }).pinRenormControlEnabled, false);
    }
});

test("Director state colors use one active green and neutral off token", () => {
    assert.equal(DIRECTOR_STATE_COLORS.accent, "#4fff8f");
    assert.equal(DIRECTOR_STATE_COLORS.activeBackground, "#163723");
    assert.equal(DIRECTOR_STATE_COLORS.neutralBackground, "#252525");
});

test("legacy workflow values insert Color Re-anchor false without shifting later widgets", () => {
    const currentWidgets = [
        { name: "motion_context_enabled" },
        { name: "context_length" },
        { name: "source_overlap_frames" },
        { name: "audio_context_enabled" },
        { name: "color_reanchor_enabled" },
        { name: "steps" },
        { name: "sampler_name" },
        { name: "scheduler" },
    ];
    const legacy = {
        widgets_values: [true, 22, 5, true, 25, "res_multistep", "simple"],
    };

    assert.equal(migrateColorReanchorWidgetValues(legacy, currentWidgets), true);
    assert.deepEqual(
        legacy.widgets_values,
        [true, 22, 5, true, false, 25, "res_multistep", "simple"],
    );
    assert.equal(migrateColorReanchorWidgetValues(legacy, currentWidgets), false);
});

test("frontend uses a global 32-pixel H3 canvas for every task", () => {
    assert.equal(resolveH3SpatialStride({
        taskKey: "i2v",
        segmentCount: 1,
        motionContextEnabled: false,
    }), 32);
    assert.equal(resolveH3SpatialStride({
        taskKey: "i2v",
        segmentCount: 3,
        motionContextEnabled: true,
    }), 32);
    assert.equal(resolveH3SpatialStride({
        taskKey: "r2v",
        segmentCount: 1,
        motionContextEnabled: false,
        hasReferenceVideo: false,
    }), 32);
    assert.equal(resolveH3SpatialStride({
        taskKey: "r2v",
        segmentCount: 1,
        motionContextEnabled: false,
        hasReferenceVideo: true,
    }), 32);
    for (const taskKey of ["v2v", "rv2v"]) {
        assert.equal(resolveH3SpatialStride({ taskKey, segmentCount: 1 }), 32);
        assert.equal(resolveH3SpatialStride({
            taskKey,
            segmentCount: 2,
            sourceBridgeValue: 5,
        }), 32);
    }
});

test("hidden widgets consume zero height and restore their original size", () => {
    const originalComputeSize = (width) => [width, 24];
    const widget = {
        hidden: false,
        options: { hidden: false },
        computeSize: originalComputeSize,
        element: { style: { display: "" } },
    };
    setWidgetVisibility(widget, false);
    assert.deepEqual(widget.computeSize(300), [0, 0]);
    assert.equal(widget.hidden, true);
    assert.equal(widget.options.hidden, true);
    assert.equal(widget.element.style.display, "none");
    setWidgetVisibility(widget, true);
    assert.deepEqual(widget.computeSize(300), [300, 24]);
    assert.equal(widget.hidden, false);
    assert.equal(widget.options.hidden, false);
    assert.equal(widget.element.style.display, "");
});

test("continuity tooltip updates both legacy widget and current options surfaces", () => {
    const requiredSpec = ["BOOLEAN", { tooltip: "old" }];
    const widget = {
        name: "motion_context_enabled",
        tooltip: "old",
        options: { tooltip: "old" },
        inputData: ["BOOLEAN", { tooltip: "old" }],
    };
    const node = {
        constructor: {
            nodeData: {
                input: { required: { motion_context_enabled: requiredSpec } },
            },
        },
    };
    setWidgetTooltip(widget, "short", node);
    assert.equal(widget.tooltip, "short");
    assert.equal(widget.options.tooltip, "short");
    assert.equal(widget.inputData[1].tooltip, "short");
    assert.equal(requiredSpec[1].tooltip, "short");
});

test("continuity tooltip can be shortened before the node definition is registered", () => {
    const requiredSpec = ["INT", { tooltip: "backend long help" }];
    const nodeData = {
        input: { required: { context_length: requiredSpec } },
        inputs: [{ name: "context_length", tooltip: "v3 long help" }],
    };
    setNodeInputTooltip(nodeData, "context_length", "short");
    assert.equal(requiredSpec[1].tooltip, "short");
    assert.equal(nodeData.inputs[0].tooltip, "short");
});

test("disabled widget snapshot follows workflow values loaded after node creation", () => {
    const widget = { value: true };
    syncDisabledWidgetState(widget, false);
    widget.value = false;
    syncDisabledWidgetState(widget, false);
    widget.value = true;
    restoreDisabledWidgetValue(widget);
    assert.equal(widget.value, false);
});

test("backend widget changes notify save, undo and graph history", () => {
    const calls = [];
    const widget = {
        name: "source_overlap_frames",
        value: 0,
        callback(value) { calls.push(["callback", value]); },
    };
    const node = {
        graph: { incrementVersion() { calls.push(["version"]); } },
        onWidgetChanged(name, value, oldValue, changedWidget) {
            calls.push(["changed", name, value, oldValue, changedWidget]);
        },
        setDirtyCanvas(fg, bg) { calls.push(["dirty", fg, bg]); },
    };
    assert.equal(notifyWidgetValueChange(node, widget, 5), true);
    assert.equal(widget.value, 5);
    assert.deepEqual(calls[1], ["changed", "source_overlap_frames", 5, 0, widget]);
    assert.equal(notifyWidgetValueChange(node, widget, 5), false);
    assert.equal(calls.length, 4);
});

test("strategy selection changes the real backend widgets and preserves unrelated preferences", () => {
    const changed = [];
    const sourceWidget = { name: "source_overlap_frames", value: 5 };
    const motionWidget = { name: "motion_context_enabled", value: true };
    const node = {
        contextFrames: 1,
        audioContextEnabled: true,
        onWidgetChanged(name, value, oldValue) { changed.push([name, value, oldValue]); },
    };
    applyVideoStrategyToWidgets({
        node,
        sourceWidget,
        motionWidget,
        strategy: VIDEO_CONTINUITY_STRATEGIES.OFF,
    });
    assert.equal(sourceWidget.value, 0);
    assert.equal(motionWidget.value, false);
    assert.deepEqual(changed, [
        ["source_overlap_frames", 0, 5],
        ["motion_context_enabled", false, true],
    ]);
    assert.equal(node.contextFrames, 1);
    assert.equal(node.audioContextEnabled, true);
});

test("disabled callback accepts serialized workflow values only during onConfigure", () => {
    const widget = {
        value: false,
        _mmxContinuityDisabled: true,
        _mmxContinuityStoredValue: true,
    };
    assert.equal(handleDisabledWidgetCallback(widget), "block");
    assert.equal(widget.value, true);

    widget.value = false;
    assert.equal(handleDisabledWidgetCallback(widget, { configuring: true }), "allow");
    assert.equal(widget.value, false);
    assert.equal(widget._mmxContinuityStoredValue, false);
});

test("pin proxy toggles only the real pin backend widget", () => {
    const calls = [];
    const pin = { name: "pin_renorm_enabled", value: false };
    const node = {
        onWidgetChanged(name, value, oldValue) { calls.push([name, value, oldValue]); },
    };
    assert.equal(toggleBooleanWidgetValue(node, pin, true), true);
    assert.equal(pin.value, true);
    assert.deepEqual(calls, [["pin_renorm_enabled", true, false]]);
    assert.equal(toggleBooleanWidgetValue(node, pin, false), false);
    assert.equal(pin.value, true);
});
