import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const timeline = await readFile(new URL("../web/js/minimax_timeline.js", import.meta.url), "utf8");
const batch = await readFile(new URL("../web/js/minimax_image_batch.js", import.meta.url), "utf8");
const fl2v = await readFile(new URL("../web/js/minimax_fl2v.js", import.meta.url), "utf8");
const nodeSource = await readFile(new URL("../nodes/director.py", import.meta.url), "utf8");

test("prompt-batch connector is inserted between cards, before its consumer card", () => {
    const connector = batch.indexOf("const connector = buildContextLinkConnector(editor, index)");
    const appendConnector = batch.indexOf("if (connector) list.appendChild(connector)", connector);
    const createCard = batch.indexOf('const card = document.createElement("div")', connector);
    const appendCard = batch.indexOf("list.appendChild(card)", createCard);
    assert.ok(connector >= 0);
    assert.ok(appendConnector > connector && appendConnector < createCard);
    assert.ok(appendCard > createCard);
});

test("timeline canvas has draw, hit, click, and advanced context-menu paths", () => {
    assert.match(timeline, /_contextLinkGeometry\(index, width/);
    assert.match(timeline, /return \{ type: "context-link", index: i \}/);
    assert.match(timeline, /toggleSegmentContextLink\(hit\.index\)/);
    assert.match(timeline, /openSegmentContextLinkMenu\(e, this, hit\.index\)/);
});

test("all timeline payload variants persist contextLink", () => {
    assert.match(timeline, /contextLink: clean\.contextLink/);
    assert.match(fl2v, /contextLink: s\.contextLink \|\| null/);
    assert.match(fl2v, /contextLink: shot\.contextLink \|\| null/);
});

test("link mutation uses a real timeline_data widget change transaction", () => {
    assert.match(timeline, /onWidgetChanged\?\.\("timeline_data", newValue, oldValue, this\.timelineWidget\)/);
    assert.match(timeline, /\?\.change\?\.\(\)/);
});

test("pin_renorm widgets are appended after the legacy serialized widget sequence", () => {
    const oldTail = nodeSource.indexOf("**director_perf_inputs(),");
    const experimental = nodeSource.indexOf('"bd_grp_experimental"', oldTail);
    const pin = nodeSource.indexOf('"pin_renorm_enabled"', experimental);
    assert.ok(oldTail >= 0 && experimental > oldTail && pin > experimental);
    assert.match(nodeSource.slice(pin, pin + 250), /"default": False/);
});

test("Latent Scale Lock is visually proxied into continuity without moving serialization", () => {
    const context = nodeSource.indexOf('"context_length"');
    const source = nodeSource.indexOf('"source_overlap_frames"', context);
    const audio = nodeSource.indexOf('"audio_context_enabled"', source);
    assert.ok(context >= 0 && source > context && audio > source);
    assert.match(timeline, /name: "mmx_pin_renorm_proxy"/);
    assert.match(timeline, /serialize: false/);
    assert.match(timeline, /options: \{ serialize: false \}/);
    assert.match(timeline, /setWidgetVisibility\(experimental, false\)/);
    assert.doesNotMatch(timeline, /source\.label = t\("widget\.pinRenormEnabled"\)/);
    assert.match(timeline, /toggleBooleanWidgetValue\([\s\S]*?pin/);
    assert.match(timeline, /setWidgetVisibility\(source, false\)/);
    assert.match(timeline, /setWidgetVisibility\(pin, false\)/);
});

test("executor keeps legacy fallback global while allowing explicit links", async () => {
    const source = await readFile(new URL("../director/executor_core.py", import.meta.url), "utf8");
    assert.match(source, /resolve_context_link\([\s\S]*?motion_context_enabled=motion_enabled,/);
    assert.match(source, /if context_pipeline_active or bridge_feature_active:/);
});
