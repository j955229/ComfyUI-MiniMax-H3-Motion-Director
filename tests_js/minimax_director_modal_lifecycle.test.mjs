import test from "node:test";
import assert from "node:assert/strict";

import {
    createDirectorModal,
    destroyDirectorModalForHost,
} from "../web/js/minimax_director_modal.js";

class FakeClassList {
    constructor() { this.values = new Set(); }
    add(...names) { names.forEach((name) => this.values.add(name)); }
    remove(...names) { names.forEach((name) => this.values.delete(name)); }
    contains(name) { return this.values.has(name); }
}

class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName || "div").toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.classList = new FakeClassList();
        this.dataset = {};
        this.attributes = new Map();
        this.listeners = new Map();
        this.hidden = false;
        this.isConnected = true;
        this.style = {};
        this.textContent = "";
    }
    set className(value) {
        this.classList = new FakeClassList();
        String(value || "").split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name));
    }
    get className() { return [...this.classList.values].join(" "); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }
    replaceChildren(...children) {
        this.children.forEach((child) => { child.parentElement = null; });
        this.children = [];
        this.append(...children);
    }
    addEventListener(type, handler) {
        const bucket = this.listeners.get(type) || [];
        bucket.push(handler);
        this.listeners.set(type, bucket);
    }
    removeEventListener(type, handler) {
        this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== handler));
    }
    dispatch(type, event = {}) {
        for (const handler of this.listeners.get(type) || []) handler({ target: this, ...event });
    }
    contains(target) {
        if (target === this) return true;
        return this.children.some((child) => child.contains?.(target));
    }
    focus() {}
    remove() {
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
        }
        this.parentElement = null;
        this.isConnected = false;
    }
}

function installFakeDom() {
    const head = new FakeElement("head");
    const body = new FakeElement("body");
    globalThis.document = {
        head,
        body,
        activeElement: null,
        createElement: (tagName) => new FakeElement(tagName),
        getElementById: (id) => [...head.children, ...body.children]
            .find((element) => element.id === id) || null,
    };
    globalThis.window = {
        addEventListener() {},
        removeEventListener() {},
    };
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
}

const translate = (key) => key;

test("Director closes even when lifecycle callbacks throw", () => {
    installFakeDom();
    const launcherHost = new FakeElement("div");
    let failOpen = false;
    let failClose = false;
    const originalError = console.error;
    console.error = () => {};
    try {
        const modal = createDirectorModal({
            launcherHost,
            translate,
            onOpen: () => { if (failOpen) throw new Error("open failed"); },
            onClose: () => { if (failClose) throw new Error("close failed"); },
        });

        assert.equal(modal.open(), true);
        failClose = true;
        assert.equal(modal.close({ restoreFocus: false }), true);
        assert.equal(modal.isOpen, false);
        assert.equal(modal.overlay.hidden, true);
        assert.equal(modal.overlay.getAttribute("aria-hidden"), "true");

        failClose = false;
        failOpen = true;
        assert.equal(modal.open(), false);
        assert.equal(modal.isOpen, false);
        assert.equal(modal.overlay.hidden, true);
    } finally {
        console.error = originalError;
        destroyDirectorModalForHost(launcherHost);
    }
});

test("Director close button dismisses the modal", () => {
    installFakeDom();
    const launcherHost = new FakeElement("div");
    const modal = createDirectorModal({ launcherHost, translate });
    assert.equal(modal.open(), true);
    let prevented = false;
    let stopped = false;
    modal.closeButton.dispatch("click", {
        preventDefault: () => { prevented = true; },
        stopPropagation: () => { stopped = true; },
    });
    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(modal.isOpen, false);
    assert.equal(modal.overlay.hidden, true);
    assert.equal(destroyDirectorModalForHost(launcherHost), true);
    assert.equal(destroyDirectorModalForHost(launcherHost), false);
});
