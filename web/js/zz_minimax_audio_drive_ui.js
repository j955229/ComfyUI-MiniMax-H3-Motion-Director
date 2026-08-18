import { app } from "../../scripts/app.js";
import { getLocale } from "./minimax_i18n.js";
import {
    AUDIO_MODE_DRIVE,
    applyVisibleAudioMode,
    visibleAudioMode,
} from "./minimax_audio_mode_core.mjs";

const DIRECTOR_CLASS = "MiniMaxH3MotionDirector";

function labels() {
    if (getLocale() === "en") {
        return {
            name: "Audio Drive",
            title: "Use the source-video audio to drive H3 lip, expression and motion generation while keeping the original source track in the final video.",
        };
    }
    return {
        name: "原声驱动",
        title: "读取源视频原声作为 H3 音频驱动，生成与原声同步的嘴型、表情和动作；最终输出仍使用原始音轨。",
    };
}

function audioSelect(editor) {
    return editor?.outAudioMode
        || editor?.root?.querySelector?.('[data-r="out-audio-mode"]')
        || null;
}

function syncAudioDriveUi(node) {
    const editor = node?._minimaxEditor;
    const select = audioSelect(editor);
    if (!editor || !select) return false;

    let option = Array.from(select.options || []).find((item) => item.value === AUDIO_MODE_DRIVE);
    let changed = false;
    if (!option) {
        option = document.createElement("option");
        option.value = AUDIO_MODE_DRIVE;
        const mute = Array.from(select.options || []).find((item) => item.value === "mute");
        select.insertBefore(option, mute || null);
        changed = true;
    }
    const text = labels();
    if (option.textContent !== text.name) {
        option.textContent = text.name;
        changed = true;
    }
    option.title = text.title;
    select.title = select.title || text.title;

    if (!select._mmxAudioDrivePatched) {
        const originalOnChange = select.onchange;
        select.onchange = (event) => {
            editor.timeline = editor.timeline || {};
            editor.timeline.output = editor.timeline.output || {};
            if (select.value === AUDIO_MODE_DRIVE) {
                applyVisibleAudioMode(editor.timeline.output, AUDIO_MODE_DRIVE);
                editor.onOutputField?.("audioMode", "source");
                editor.timeline.output.audioDrive = true;
                select.value = AUDIO_MODE_DRIVE;
                editor.scheduleTimelineSync?.();
                editor.updateSegmentContinuityUI?.();
                node?.setDirtyCanvas?.(true, true);
                return;
            }
            applyVisibleAudioMode(editor.timeline.output, select.value);
            originalOnChange?.call(select, event);
            editor.timeline.output.audioDrive = false;
            editor.scheduleTimelineSync?.();
        };
        select._mmxAudioDrivePatched = true;
        changed = true;
    }

    const desired = visibleAudioMode(editor.timeline?.output || {});
    if (select.value !== desired) {
        select.value = desired;
        changed = true;
    }
    return changed;
}

function scheduleSync(node) {
    for (const delay of [0, 80, 250, 800]) {
        setTimeout(() => syncAudioDriveUi(node), delay);
    }
}

function wrapDirector(nodeType) {
    for (const hook of ["onNodeCreated", "onConfigure", "onWidgetChanged"]) {
        const original = nodeType.prototype[hook];
        nodeType.prototype[hook] = function () {
            const result = original?.apply(this, arguments);
            scheduleSync(this);
            return result;
        };
    }
    const originalDraw = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function () {
        syncAudioDriveUi(this);
        return originalDraw?.apply(this, arguments);
    };
}

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.AudioDrive",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== DIRECTOR_CLASS) return;
        wrapDirector(nodeType);
    },
});
