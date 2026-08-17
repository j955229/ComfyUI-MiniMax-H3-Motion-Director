export const RUN_SELECTION_MISMATCH_ERROR = "Motion Director internal run-selection state mismatch.";

function normalizedSelection(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .map((index) => Number.parseInt(index, 10))
        .filter((index) => Number.isInteger(index) && index >= 0))]
        .sort((left, right) => left - right);
}

function activeRunSelectionTimeline(editor) {
    if (editor?.isMixedMode?.()) {
        return editor?.mixedTimeline ?? editor?.timeline;
    }
    return editor?.timeline;
}

function memoryRunSelectionState(editor) {
    const timeline = activeRunSelectionTimeline(editor);
    const enabled = !!timeline?.runSelectEnabled;
    return {
        enabled,
        // When Run Selection is off, runSelection is remembered UI state only.
        // Execution serialization intentionally canonicalizes it to [].
        selection: enabled ? normalizedSelection(timeline?.runSelection) : [],
    };
}

function serializedRunSelectionState(editor) {
    try {
        const payload = JSON.parse(String(editor?.timelineWidget?.value || "{}"));
        const enabled = !!payload.runSelectEnabled;
        return {
            enabled,
            selection: enabled ? normalizedSelection(payload.runSelection) : [],
        };
    } catch {
        return null;
    }
}

export function runSelectionStateMatchesSerialized(editor) {
    const memory = memoryRunSelectionState(editor);
    const serialized = serializedRunSelectionState(editor);
    return !!serialized
        && memory.enabled === serialized.enabled
        && memory.selection.length === serialized.selection.length
        && memory.selection.every((value, index) => value === serialized.selection[index]);
}

function writeTimelineSynchronously(editor) {
    if (!editor?.timelineWidget || typeof editor?._writeTimelineWidget !== "function") {
        throw new Error(RUN_SELECTION_MISMATCH_ERROR);
    }
    clearTimeout(editor._syncTimer);
    editor._syncTimer = null;
    editor._writeTimelineWidget();
}

export function commitRunSelectionMutation(editor, mutation) {
    try {
        if (typeof mutation === "function") mutation();
        editor?.normalizeRunSelection?.();
        writeTimelineSynchronously(editor);
    } catch {
        throw new Error(RUN_SELECTION_MISMATCH_ERROR);
    }
    if (!runSelectionStateMatchesSerialized(editor)) {
        throw new Error(RUN_SELECTION_MISMATCH_ERROR);
    }
}

export function ensureRunSelectionSerialized(editor) {
    // Flush ordinary debounced timeline edits first. Run Selection itself is
    // normally already current because every execution-semantic mutation uses
    // commitRunSelectionMutation().
    try {
        editor?.flushTimelineSync?.();
    } catch {
        throw new Error(RUN_SELECTION_MISMATCH_ERROR);
    }
    if (runSelectionStateMatchesSerialized(editor)) return;

    try {
        editor?.normalizeRunSelection?.();
        writeTimelineSynchronously(editor);
    } catch {
        throw new Error(RUN_SELECTION_MISMATCH_ERROR);
    }
    if (!runSelectionStateMatchesSerialized(editor)) {
        throw new Error(RUN_SELECTION_MISMATCH_ERROR);
    }
}
