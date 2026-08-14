import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const output = readFileSync(new URL("../web/js/minimax_output_ui.mjs", import.meta.url), "utf8");
const timeline = readFileSync(new URL("../web/js/minimax_timeline.js", import.meta.url), "utf8");

test("Output is the unique generated-result and run-progress center", () => {
    for (const label of ["实时", "分段", "多段", "最终结果", "Overall Progress", "Current Stage Progress", "Preview Settings", "Report"]) assert.ok(output.includes(label));
    assert.match(output, /data-result-seek/);
    assert.match(output, /data-r="run-status"/);
    assert.doesNotMatch(timeline, /bd-btn-live-preview/);
    assert.match(output, /\.mmx-result-viewer \[hidden\]\{display:none!important\}/);
    assert.match(output, /\.mmx-result-controls>label\{display:grid/);
    assert.match(output, /input\[type=checkbox\].*justify-self:start/);
    assert.match(output, /data-preview-settings-card/);
    assert.match(output, /data-save-video-card/);
    assert.match(output, /previewCard\.hidden\s*=\s*tab\s*!==\s*"live"/);
    assert.match(output, /saveCard\.hidden\s*=\s*tab\s*!==\s*"final"/);
    assert.doesNotMatch(output, /setInterval\s*\(/);
    assert.match(output, /requestAnimationFrame|ResultPlaybackController/);
    assert.match(output, /const setTab = \(tab\) => \{\s*stop\(\)/);
    assert.match(output, /segmentSelect\.addEventListener\("change", \(\) => \{ stop\(\)/);
    assert.match(output, /const clear = \(\) => \{\s*stop\(\)/);
    assert.match(output, /destroy\(\) \{\s*playback\.destroy\(\)/);
    assert.match(output, /fetchApi\("\/minimax\/motion-director\/save_video"/);
    assert.doesNotMatch(output, /queuePrompt|sample_single_stage/);
});

test("Generation keeps source player seek and frame navigation", () => {
    assert.match(timeline, /data-a="frame-prev"/);
    assert.match(timeline, /data-a="frame-next"/);
    assert.match(timeline, /data-r="seek"/);
    assert.match(timeline, /data-r="player-timecode"/);
});

test("node-scoped backend preview and report events route only into Output", () => {
    assert.match(timeline, /addEventListener\("minimax_motion_director_preview"[\s\S]*outputUi\?\.consumePreview/);
    assert.match(timeline, /addEventListener\("minimax_motion_director_report"[\s\S]*outputUi\?\.setReport/);
    assert.match(timeline, /addEventListener\("minimax_motion_director_audio"[\s\S]*outputUi\?\.setAudio/);
    assert.match(timeline, /addEventListener\("minimax_motion_director_final_ready"[\s\S]*outputUi\?\.setFinalRecord/);
});
