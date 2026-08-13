import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLocale, t } from "../web/js/minimax_i18n.js";

import {
    formatR2vAssetStatusLabel,
    mountR2vCommonSelection,
    mountR2vMediaLayout,
} from "../web/js/minimax_r2v_reference_ui.mjs";

class TestClassList {
    constructor(owner) {
        this.owner = owner;
        this.values = new Set();
    }

    setFromString(value) {
        this.values = new Set(String(value || "").split(/\s+/).filter(Boolean));
    }

    add(...names) {
        names.forEach((name) => this.values.add(name));
        this.owner._className = [...this.values].join(" ");
    }

    contains(name) { return this.values.has(name); }
}

class TestElement {
    constructor(tagName) {
        this.tagName = String(tagName || "div").toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.attributes = new Map();
        this.dataset = {};
        this.style = {};
        this.classList = new TestClassList(this);
        this._className = "";
        this.textContent = "";
        this.checked = false;
        this.type = "";
    }

    set className(value) {
        this._className = String(value || "");
        this.classList.setFromString(this._className);
    }

    get className() { return this._className; }

    append(...children) { children.forEach((child) => this.appendChild(child)); }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    setAttribute(name, value) {
        const text = String(value);
        this.attributes.set(name, text);
        if (name.startsWith("data-")) {
            const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
            this.dataset[key] = text;
        }
    }

    getAttribute(name) { return this.attributes.get(name) ?? null; }
}

class TestDocument {
    createElement(tagName) { return new TestElement(tagName); }
}

function descendants(root) {
    const result = [];
    const visit = (node) => {
        for (const child of node.children) {
            result.push(child);
            visit(child);
        }
    };
    visit(root);
    return result;
}

test("Segment media layout keeps its Local assets and prompt/preview columns", () => {
    const documentRef = new TestDocument();
    const card = documentRef.createElement("div");
    const layout = mountR2vMediaLayout(card, { documentRef });

    assert.equal(layout.main.classList.contains("bd-batch-r2v-main"), true);
    assert.equal(layout.assets.classList.contains("bd-batch-r2v-assets"), true);
    assert.equal(
        descendants(card).some((element) => element.classList.contains("bd-batch-r2v-main")),
        true,
    );
});

test("Segment Common selection has select actions and item checkboxes without a master checkbox", () => {
    const documentRef = new TestDocument();
    const card = documentRef.createElement("div");
    const calls = [];
    mountR2vCommonSelection(card, {
        documentRef,
        assets: [
            { kind: "picture", assetId: "A", label: "A.png", status: "active", effectiveTag: "<Picture 1>" },
            { kind: "picture", assetId: "B", label: "B.png", status: "disabled", effectiveTag: "" },
            { kind: "picture", assetId: "C", label: "C.png", status: "active", effectiveTag: "<Picture 2>" },
        ],
        labels: {
            title: "公共素材",
            selectAll: "全选",
            selectNone: "全不选",
            empty: "没有公共素材",
            disabled: "已关闭",
            kind: () => "图片",
        },
        onSelectAll: () => calls.push("all"),
        onSelectNone: () => calls.push("none"),
        onToggle: (assetId, checked) => calls.push(`${assetId}:${checked}`),
    });

    const nodes = descendants(card);
    assert.equal(nodes.some((element) => element.classList.contains("bd-r2v-use-common-assets")), false);
    const checkboxes = nodes.filter((element) => element.tagName === "INPUT" && element.type === "checkbox");
    assert.equal(checkboxes.length, 3);
    assert.deepEqual(checkboxes.map((checkbox) => checkbox.checked), [true, false, true]);
    const labels = nodes
        .filter((element) => element.dataset.r === "r2v-common-asset-label")
        .map((element) => element.textContent);
    assert.deepEqual(labels, [
        "图片: A.png · <Picture 1>",
        "图片: B.png · 已关闭",
        "图片: C.png · <Picture 2>",
    ]);

    nodes.find((element) => element.dataset.a === "r2v-common-select-all").onclick({ preventDefault() {}, stopPropagation() {} });
    nodes.find((element) => element.dataset.a === "r2v-common-select-none").onclick({ preventDefault() {}, stopPropagation() {} });
    checkboxes[1].checked = true;
    checkboxes[1].onchange({ stopPropagation() {} });
    assert.deepEqual(calls, ["all", "none", "B:true"]);
});

test("disabled Common asset status is localized", () => {
    setLocale("zh");
    assert.equal(t("batch.r2v.disabled"), "已关闭");
    setLocale("en");
    assert.equal(t("batch.r2v.disabled"), "disabled");
});

test("disabled Common mention commits after its semantic token is inserted", () => {
    const source = readFileSync(new URL("../web/js/minimax_image_batch.js", import.meta.url), "utf8");
    const enableStart = source.indexOf("onEnableAsset: (item) => {");
    const insertedStart = source.indexOf("onMentionInserted: (_item, { wasDisabled }) => {", enableStart);
    const callbackEnd = source.indexOf("            });", insertedStart);
    assert.ok(enableStart >= 0 && insertedStart > enableStart && callbackEnd > insertedStart);

    const enableBlock = source.slice(enableStart, insertedStart);
    const insertedBlock = source.slice(insertedStart, callbackEnd);
    assert.doesNotMatch(enableBlock, /editor\.commit\s*\(/);
    assert.match(insertedBlock, /editor\.commit\(true, \{ syncTimeline: true \}\)/);
    const commitAt = insertedBlock.indexOf("editor.commit");
    const deferredRebuildAt = insertedBlock.indexOf("setTimeout");
    assert.ok(
        commitAt >= 0 && (deferredRebuildAt < 0 || commitAt < deferredRebuildAt),
        "the enabled state and inserted token must commit before any deferred prompt-card rebuild",
    );
});

test("Local asset card labels follow the current effective tag", () => {
    for (const [effectiveTag, expected] of [
        ["<Picture 4>", "D.png · <Picture 4>"],
        ["<Picture 2>", "D.png · <Picture 2>"],
        ["<Picture 1>", "D.png · <Picture 1>"],
    ]) {
        assert.equal(formatR2vAssetStatusLabel({
            name: "D.png",
            status: "active",
            effectiveTag,
        }, "已关闭"), expected);
    }
    assert.equal(formatR2vAssetStatusLabel({
        name: "B.png",
        status: "disabled",
        effectiveTag: "",
    }, "已关闭"), "B.png · 已关闭");
});
