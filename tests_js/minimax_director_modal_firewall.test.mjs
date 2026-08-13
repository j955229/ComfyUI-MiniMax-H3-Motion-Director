import test from "node:test";
import assert from "node:assert/strict";

import {
    isolateDirectorEditingEvent,
    shouldIsolateDirectorEditingEvent,
} from "../web/js/minimax_director_modal.js";

function tree(tagName, parent = null, options = {}) {
    return {
        tagName,
        parentElement: parent,
        nodeType: options.nodeType,
        isContentEditable: !!options.contentEditable,
        classList: { contains: (name) => options.className === name },
        getAttribute(name) {
            if (name === "contenteditable" && options.contentEditable) return "true";
            return null;
        },
    };
}

function overlayWithContains() {
    const overlay = tree("DIV");
    overlay.contains = (target) => {
        for (let node = target; node; node = node.parentElement) {
            if (node === overlay) return true;
        }
        return false;
    };
    return overlay;
}

test("Director Ctrl/Cmd+V stays in the prompt without cancelling native paste", () => {
    const overlay = overlayWithContains();
    const editor = tree("DIV", overlay, { className: "bd-prompt-editor", contentEditable: true });
    const calls = [];
    const event = {
        type: "keydown",
        key: "v",
        ctrlKey: true,
        target: editor,
        preventDefault() { calls.push("preventDefault"); },
        stopPropagation() { calls.push("stopPropagation"); },
        stopImmediatePropagation() { calls.push("stopImmediatePropagation"); },
    };
    assert.equal(shouldIsolateDirectorEditingEvent(event, overlay, true), true);
    assert.equal(isolateDirectorEditingEvent(event, overlay, true), true);
    assert.deepEqual(calls, ["stopImmediatePropagation", "stopPropagation"]);
});

test("copy, cut, paste, select-all, undo/redo and deletion are isolated for editable controls", () => {
    const overlay = overlayWithContains();
    const textarea = tree("TEXTAREA", overlay);
    for (const key of ["a", "c", "v", "x", "y", "z"]) {
        assert.equal(shouldIsolateDirectorEditingEvent({
            type: "keydown", key, ctrlKey: true, target: textarea,
        }, overlay, true), true);
        assert.equal(shouldIsolateDirectorEditingEvent({
            type: "keydown", key, metaKey: true, target: textarea,
        }, overlay, true), true);
    }
    for (const key of ["Backspace", "Delete"]) {
        assert.equal(shouldIsolateDirectorEditingEvent({
            type: "keydown", key, target: textarea,
        }, overlay, true), true);
    }
    assert.equal(shouldIsolateDirectorEditingEvent({ type: "paste", target: textarea }, overlay, true), true);
    assert.equal(shouldIsolateDirectorEditingEvent({ type: "beforeinput", target: textarea }, overlay, true), true);
});

test("IME, closed modal and non-editable graph commands are not intercepted", () => {
    const overlay = overlayWithContains();
    const textarea = tree("TEXTAREA", overlay);
    const canvas = tree("CANVAS", overlay);
    assert.equal(shouldIsolateDirectorEditingEvent({
        type: "keydown", key: "v", ctrlKey: true, target: textarea, isComposing: true,
    }, overlay, true), false);
    assert.equal(shouldIsolateDirectorEditingEvent({
        type: "keydown", key: "v", ctrlKey: true, target: textarea,
    }, overlay, false), false);
    assert.equal(shouldIsolateDirectorEditingEvent({
        type: "keydown", key: "v", ctrlKey: true, target: canvas,
    }, overlay, true), false);
});
