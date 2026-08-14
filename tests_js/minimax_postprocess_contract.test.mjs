import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../web/js/minimax_timeline.js", import.meta.url), "utf8");

test("node proxy order is continuity then postprocess then advanced then performance", () => {
    assert.match(source, /installDirectorPostprocessUi\(node\);[\s\S]*moveDirectorPerfWidgetsBeforeTimeline\(node\);[\s\S]*moveDirectorDomWidgetToEnd\(node\)/);
    assert.match(source, /advancedIndex = node\.widgets\.findIndex\(\(item\) => item\.name === "bd_grp_advanced"\)/);
    assert.deepEqual(
        [...source.matchAll(/\["mmx_(?:postprocess_group|global_refine_proxy|face_refine_proxy)"/g)].map((match) => match[0]),
        ['["mmx_postprocess_group"', '["mmx_global_refine_proxy"', '["mmx_face_refine_proxy"'],
    );
});

test("main-node postprocess controls reuse the Director group and boolean visual system", () => {
    assert.match(source, /makeGroupHeaderWidget\(name, \["BDGROUP"/);
    assert.match(source, /drawDirectorBooleanWidget\.call\(this, ctx, node, width, y, height\)/);
    assert.match(source, /mmx_global_refine_summary/);
    assert.match(source, /mmx_face_refine_summary/);
    assert.doesNotMatch(source, /fillText\(enabled \? "ON" : "OFF"/);
});

test("transient visual widgets cannot shift workflow widget deserialization", () => {
    assert.match(source, /onConfigure = function \(\) \{[\s\S]*?detachDirectorTransientWidgets\(this\);[\s\S]*?onConfigure\?\.apply/);
    assert.match(source, /DIRECTOR_TRANSIENT_WIDGETS = new Set/);
    assert.match(source, /repairInvalidDirectorSamplingState\(this\)/);
    assert.match(source, /invalidCount < 2/);
    assert.match(source, /videoShift\.value = 12/);
    assert.match(source, /audioShift\.value = 3/);
});

test("only requested modes swap existing output and source-control rows", () => {
    assert.match(source, /\["fl2v", "r2v", "v2v", "rv2v"\]\.includes\(taskKey\)/);
    assert.match(source, /stageEl\.after\(outputBarEl\)/);
    assert.match(source, /outputBarEl\.after\(splitEditBarEl\)/);
    assert.match(source, /splitEditBarEl\.after\(viewport\)/);
    assert.match(source, /viewport\.after\(controlsBar\)/);
    assert.match(source, /stageEl\.after\(controlsBar\)/);
    assert.match(source, /this\.updateGenerationRowOrder\(taskKey\)/);
    assert.match(source, /classList\.toggle\("bd-output-before-timeline", swapOutputAndSourceControls\)/);
    const strideBody = source.match(/getH3SpatialStride\(\) \{([\s\S]*?)\n    \}/)?.[1] || "";
    assert.doesNotMatch(strideBody, /\.after\(|insertBefore/);
});

test("new pages and node summaries use the launcher's single locale source", () => {
    assert.match(source, /mountPostprocessUI[\s\S]*locale: getLocale/);
    assert.match(source, /mountOutputUI[\s\S]*locale: getLocale[\s\S]*fetchApi:/);
    assert.match(source, /postprocessUi\?\.updateLocale\?\.\(getLocale\(\)\)/);
    assert.match(source, /outputUi\?\.updateLocale\?\.\(getLocale\(\)\)/);
    assert.match(source, /globalRefineSummary\([\s\S]*getLocale\(\)/);
    assert.match(source, /faceRefineSummary\(config, getLocale\(\)\)/);
});
