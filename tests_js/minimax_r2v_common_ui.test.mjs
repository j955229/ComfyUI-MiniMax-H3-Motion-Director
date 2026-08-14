import test from "node:test";
import assert from "node:assert/strict";
import { setLocale, t } from "../web/js/minimax_i18n.js";
import {
    mountR2vCommonToggle,
    syncR2vCommonToggle,
    syncR2vCommonToggleForTask,
} from "../web/js/minimax_r2v_common_ui.mjs";

class TestClassList {
    constructor() { this.values = new Set(); }
    add(...names) { names.forEach((name) => this.values.add(name)); }
    contains(name) { return this.values.has(name); }
    toggle(name, force) {
        const enabled = force === undefined ? !this.values.has(name) : !!force;
        if (enabled) this.values.add(name);
        else this.values.delete(name);
        return enabled;
    }
}

class TestElement {
    constructor(tagName) {
        this.tagName = String(tagName || "div").toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.dataset = {};
        this.attributes = new Map();
        this.classList = new TestClassList();
        this.textContent = "";
        this.title = "";
        this.type = "";
    }

    appendChild(child) {
        if (child.parentElement) {
            const oldSiblings = child.parentElement.children;
            oldSiblings.splice(oldSiblings.indexOf(child), 1);
        }
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    replaceWith(child) {
        const siblings = this.parentElement?.children;
        const index = siblings?.indexOf(this) ?? -1;
        if (!siblings || index < 0) return;
        child.parentElement = this.parentElement;
        siblings[index] = child;
        this.parentElement = null;
    }

    insertAdjacentElement(position, child) {
        assert.equal(position, "afterend");
        const siblings = this.parentElement?.children;
        const index = siblings?.indexOf(this) ?? -1;
        if (!siblings || index < 0) return null;
        child.parentElement = this.parentElement;
        siblings.splice(index + 1, 0, child);
        return child;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === "data-a") this.dataset.a = String(value);
    }

    getAttribute(name) { return this.attributes.get(name) ?? null; }

    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

    querySelectorAll(selector) {
        const match = selector.match(/^\[data-a="([^"]+)"\]$/);
        if (!match) return [];
        const output = [];
        const visit = (node) => {
            if (node.dataset?.a === match[1]) output.push(node);
            node.children.forEach(visit);
        };
        this.children.forEach(visit);
        return output;
    }

    get nextElementSibling() {
        const siblings = this.parentElement?.children || [];
        return siblings[siblings.indexOf(this) + 1] || null;
    }
}

class TestDocument {
    createElement(tagName) { return new TestElement(tagName); }
}

test("R2V Common toggle mounts next to live preview inside the output bar", () => {
    assert.equal(typeof mountR2vCommonToggle, "function");
    const documentRef = new TestDocument();
    const outputBar = documentRef.createElement("div");
    const livePreview = documentRef.createElement("button");
    livePreview.setAttribute("data-a", "live-tae-preview");
    outputBar.appendChild(livePreview);

    const toggle = mountR2vCommonToggle(outputBar, documentRef);
    const repeatedMount = mountR2vCommonToggle(outputBar, documentRef);

    assert.equal(toggle.parentElement.classList.contains("bd-output-button-group"), true);
    assert.equal(toggle.parentElement.parentElement, outputBar);
    assert.equal(livePreview.parentElement, toggle.parentElement);
    assert.equal(livePreview.nextElementSibling, toggle);
    assert.equal(repeatedMount, toggle);
    assert.equal(toggle.dataset.a, "r2v-common-toggle");
    assert.equal(outputBar.querySelectorAll('[data-a="r2v-common-toggle"]').length, 1);
});

test("R2V Common toggle remains in Generation after generated-result preview moves to Output", () => {
    const documentRef = new TestDocument();
    const outputBar = documentRef.createElement("div");
    const toggle = mountR2vCommonToggle(outputBar, documentRef);
    assert.equal(toggle.parentElement.classList.contains("bd-output-button-group"), true);
    assert.equal(toggle.parentElement.parentElement, outputBar);
    assert.equal(outputBar.querySelector('[data-a="live-tae-preview"]'), null);
});

test("R2V Common toggle visibility, active state and tooltip follow task and expansion", () => {
    assert.equal(typeof syncR2vCommonToggle, "function");
    const documentRef = new TestDocument();
    const outputBar = documentRef.createElement("div");
    const livePreview = documentRef.createElement("button");
    livePreview.setAttribute("data-a", "live-tae-preview");
    outputBar.appendChild(livePreview);
    const toggle = mountR2vCommonToggle(outputBar, documentRef);
    const labels = {
        label: "公共素材",
        expandTitle: "展开公共素材",
        collapseTitle: "收起公共素材",
    };

    syncR2vCommonToggle(toggle, { visible: true, expanded: false, ...labels });
    assert.equal(toggle.classList.contains("hidden"), false);
    assert.equal(toggle.classList.contains("active"), false);
    assert.equal(toggle.textContent, "公共素材");
    assert.equal(toggle.title, "展开公共素材");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");

    syncR2vCommonToggle(toggle, { visible: true, expanded: true, ...labels });
    assert.equal(toggle.classList.contains("active"), true);
    assert.equal(toggle.title, "收起公共素材");
    assert.equal(toggle.getAttribute("aria-expanded"), "true");

    syncR2vCommonToggle(toggle, { visible: false, expanded: true, ...labels });
    assert.equal(toggle.classList.contains("hidden"), true);
    assert.equal(toggle.classList.contains("active"), false);
});

test("R2V Common toggle is hidden for every non-R2V task", () => {
    assert.equal(typeof syncR2vCommonToggleForTask, "function");
    const documentRef = new TestDocument();
    const outputBar = documentRef.createElement("div");
    const livePreview = documentRef.createElement("button");
    livePreview.setAttribute("data-a", "live-tae-preview");
    outputBar.appendChild(livePreview);
    const toggle = mountR2vCommonToggle(outputBar, documentRef);
    const labels = {
        label: "Common References",
        expandTitle: "Expand Common References",
        collapseTitle: "Collapse Common References",
    };

    syncR2vCommonToggleForTask(toggle, { taskKey: "r2v", expanded: false, ...labels });
    assert.equal(toggle.classList.contains("hidden"), false);
    for (const taskKey of ["t2v", "i2v", "fl2v", "v2v", "rv2v"]) {
        syncR2vCommonToggleForTask(toggle, { taskKey, expanded: true, ...labels });
        assert.equal(toggle.classList.contains("hidden"), true, taskKey);
        assert.equal(toggle.classList.contains("active"), false, taskKey);
    }
});

test("R2V Common output button labels and stateful tooltips are localized", () => {
    setLocale("zh");
    assert.equal(t("batch.r2v.commonReferences"), "公共素材");
    assert.equal(t("tooltip.r2vCommonExpand"), "展开公共素材");
    assert.equal(t("tooltip.r2vCommonCollapse"), "收起公共素材");

    setLocale("en");
    assert.equal(t("batch.r2v.commonReferences"), "Common References");
    assert.equal(t("tooltip.r2vCommonExpand"), "Expand Common References");
    assert.equal(t("tooltip.r2vCommonCollapse"), "Collapse Common References");
});
