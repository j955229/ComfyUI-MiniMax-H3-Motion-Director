import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../web/js/minimax_director_modal.js", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../web/js/minimax_i18n.js", import.meta.url), "utf8");

test("one Director modal owns exactly three cyclic button-driven pages", () => {
    assert.match(source, /DIRECTOR_PAGES = \["generation", "postprocess", "output"\]/);
    assert.match(source, /cyclePage\(direction = 1\)/);
    assert.match(source, /page-previous/);
    assert.match(source, /page-next/);
    assert.doesNotMatch(source, /touchstart|touchmove|pointermove[\s\S]*cyclePage/);
    assert.equal((source.match(/role", "dialog"/g) || []).length, 1);
});

test("Chinese launcher locale names Generation and Output in Chinese", () => {
    assert.match(i18n, /"modal\.page\.generation": "生成"/);
    assert.match(i18n, /"modal\.page\.postprocess": "后期处理"/);
    assert.match(i18n, /"modal\.page\.output": "结果预览"/);
    assert.match(i18n, /"modal\.page\.generation": "Generation"/);
    assert.match(i18n, /"modal\.page\.output": "Output"/);
});
