import assert from "node:assert/strict";
import test from "node:test";

async function loadCore() {
  try {
    return await import("../minimax_audio_editor_core.mjs");
  } catch (_) {
    return {};
  }
}

test("whole trim selection moves without changing its duration and clamps to source bounds", async () => {
  const core = await loadCore();
  assert.equal(typeof core.moveTrimSelection, "function");
  assert.deepEqual(core.moveTrimSelection(2, 5, 4, 8), { trimStart: 5, trimEnd: 8 });
  assert.deepEqual(core.moveTrimSelection(2, 5, -9, 8), { trimStart: 0, trimEnd: 3 });
});

test("audio edit history supports undo redo and drops the redo branch after a new edit", async () => {
  const core = await loadCore();
  assert.equal(typeof core.createAudioEditHistory, "function");
  const history = core.createAudioEditHistory({ trimStart: 0, trimEnd: 8, appliedTrimStart: 0, appliedTrimEnd: 8 });
  history.push({ trimStart: 1, trimEnd: 7, appliedTrimStart: 0, appliedTrimEnd: 8 });
  history.push({ trimStart: 2, trimEnd: 6, appliedTrimStart: 2, appliedTrimEnd: 6 });
  assert.equal(history.canUndo, true);
  assert.deepEqual(history.undo(), { trimStart: 1, trimEnd: 7, appliedTrimStart: 0, appliedTrimEnd: 8 });
  assert.equal(history.canRedo, true);
  assert.deepEqual(history.redo(), { trimStart: 2, trimEnd: 6, appliedTrimStart: 2, appliedTrimEnd: 6 });
  history.undo();
  history.push({ trimStart: 1.5, trimEnd: 6.5, appliedTrimStart: 0, appliedTrimEnd: 8 });
  assert.equal(history.canRedo, false);
});

test("drive row order follows stable asset order rather than timeline position", async () => {
  const core = await loadCore();
  assert.equal(typeof core.orderDriveRows, "function");
  const rows = [
    { assetId: "a", timelineStart: 9 },
    { assetId: "b", timelineStart: 0 },
    { assetId: "c", timelineStart: 4 },
  ];
  assert.deepEqual(core.orderDriveRows(rows, ["c", "a", "b"]).map((row) => row.assetId), ["c", "a", "b"]);
  rows[0].timelineStart = 1;
  rows[1].timelineStart = 8;
  assert.deepEqual(core.orderDriveRows(rows, ["c", "a", "b"]).map((row) => row.assetId), ["c", "a", "b"]);
});


test("backdrop closes only when the pointer gesture starts and ends on the backdrop", async () => {
  const core = await loadCore();
  assert.equal(typeof core.shouldCloseEditorBackdrop, "function");
  assert.equal(core.shouldCloseEditorBackdrop(true, true), true);
  assert.equal(core.shouldCloseEditorBackdrop(false, true), false);
  assert.equal(core.shouldCloseEditorBackdrop(true, false), false);
  assert.equal(core.shouldCloseEditorBackdrop(false, false), false);
});

import { readFileSync } from "node:fs";
const uiSource = readFileSync(new URL("../zz_minimax_audio_drive_ui.js", import.meta.url), "utf8");

test("audio timeline drag uses light commit and stable vertical ordering", () => {
  assert.equal(uiSource.includes("setDirtyCanvas?.(true, true)"), false);
  assert.equal(uiSource.includes("rows.sort((a, b) => a.timelineStart"), false);
  assert.equal(uiSource.includes("orderDriveRows(rows"), true);
});

test("audio editor exposes draggable selection playhead undo redo and explicit cut without loop selection", () => {
  assert.equal(uiSource.includes("mmx-audio-playhead"), true);
  assert.equal(uiSource.includes('button class="undo"'), true);
  assert.equal(uiSource.includes('button class="redo"'), true);
  assert.equal(uiSource.includes('button class="cut"'), true);
  assert.equal(uiSource.includes('button class="done"'), true);
  assert.equal(uiSource.includes('input class="loop"'), false);
  assert.equal(uiSource.includes("loopInput"), false);
  assert.equal(uiSource.includes("moveTrimSelection("), true);
});

const backdropGuardSource = readFileSync(new URL("../zzzz_minimax_audio_editor_backdrop_guard.js", import.meta.url), "utf8");

test("audio editor backdrop guard suppresses drag-release clicks without disabling deliberate backdrop clicks", () => {
  assert.equal(backdropGuardSource.includes("shouldCloseEditorBackdrop("), true);
  assert.equal(backdropGuardSource.includes('document.addEventListener("pointerdown"'), true);
  assert.equal(backdropGuardSource.includes('document.addEventListener("click"'), true);
  assert.equal(backdropGuardSource.includes("stopImmediatePropagation()"), true);
});
