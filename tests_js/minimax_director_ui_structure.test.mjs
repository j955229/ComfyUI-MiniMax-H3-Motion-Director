import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../web/js/minimax_timeline.js", import.meta.url), "utf8");
const mentions = readFileSync(new URL("../web/js/minimax_prompt_mentions.js", import.meta.url), "utf8");
const imageBatch = readFileSync(new URL("../web/js/minimax_image_batch.js", import.meta.url), "utf8");
const materialLibrary = readFileSync(new URL("../web/js/minimax_material_library_modal.mjs", import.meta.url), "utf8");

test("task selector is the first fixed toolbar control before wrapping dynamic actions", () => {
    const left = source.indexOf('class="bd-toolbar-left"');
    const anchor = source.indexOf('class="bd-task-anchor"', left);
    const selector = source.indexOf('data-r="global-task"', anchor);
    const actions = source.indexOf('class="bd-actions"', selector);
    const upload = source.indexOf('data-a="video"', actions);
    assert.ok(left >= 0 && left < anchor && anchor < selector && selector < actions && actions < upload);
    assert.match(source, /\.bd-task-anchor\{[^}]*flex:0 0 auto[^}]*order:0/);
    assert.match(source, /\.bd-actions\{[^}]*flex-wrap:wrap[^}]*order:1/);
});

test("Context Link active variants share green semantics while off is neutral", () => {
    assert.match(source, /both: \[DIRECTOR_STATE_COLORS\.activeBackground, DIRECTOR_STATE_COLORS\.accent\]/);
    assert.match(source, /visual: \[DIRECTOR_STATE_COLORS\.activeBackground, DIRECTOR_STATE_COLORS\.accent\]/);
    assert.match(source, /audio: \[DIRECTOR_STATE_COLORS\.activeBackground, DIRECTOR_STATE_COLORS\.accent\]/);
    assert.match(source, /off: \[DIRECTOR_STATE_COLORS\.neutralBackground, DIRECTOR_STATE_COLORS\.neutralBorder\]/);
    assert.match(imageBatch, /data-mode="both"\],\.bd-context-link-toggle\[data-mode="visual"\],\.bd-context-link-toggle\[data-mode="audio"\]\{border-color:#4fff8f;color:#4fff8f;background:#163723\}/);
    assert.match(imageBatch, /data-mode="off"\]\{border-color:#555;color:#aaa;background:#252525\}/);
});

test("Director BOOLEAN widgets use the shared active and neutral tokens", () => {
    assert.match(source, /w\.draw = drawDirectorBooleanWidget/);
    assert.match(source, /ctx\.strokeStyle = checked[\s\S]*?DIRECTOR_STATE_COLORS\.accent/);
    assert.match(source, /ctx\.fillStyle = checked[\s\S]*?DIRECTOR_STATE_COLORS\.activeBackground/);
    assert.doesNotMatch(source, /w\.options\.on = DIRECTOR_STATE_COLORS/);
    assert.doesNotMatch(source, /w\.options\.off = DIRECTOR_STATE_COLORS/);
    assert.match(source, /\.bd-mode button\.active\{background:var\(--mmx-active-bg\);color:var\(--mmx-accent\)\}/);
});

test("Director modal selections consistently use green active styling", () => {
    assert.match(source, /\.bd-modal-item\.selected\{background:#163723;border-color:#4fff8f;color:#4fff8f\}/);
    assert.match(mentions, /\.bd-mention-item\.active\{background:#163723;color:#4fff8f\}/);
    assert.match(materialLibrary, /\.mmx-ml-tab\.active\{border-color:#4fff8f;color:#4fff8f;background:#163723\}/);
    assert.doesNotMatch(materialLibrary, /button\.active\{border-color:#69b8ff/);
});

test("run-selection control remains a true reversible toggle", () => {
    assert.match(source, /toggleRunSelectMode\(\)[\s\S]*?runSelectEnabled = !this\.timeline\.runSelectEnabled/);
});

test("typing @ schedules the prompt mention menu directly from beforeinput", () => {
    assert.match(mentions, /isImmediateMentionTriggerEvent\(event, \{ destroyed, composing \}\)/);
    assert.match(mentions, /queueMicrotask\(\(\) => \{[\s\S]*?openIfMention\(\)/);
});
