import test from "node:test";
import assert from "node:assert/strict";

import {
    normalizeSeedControlMode,
    seedControlModeFromWidgets,
} from "../web/js/minimax_sampling_ui.js";

test("ComfyUI seed control mode is captured from the linked seed widget", () => {
    for (const mode of ["fixed", "increment", "decrement", "randomize"]) {
        const widgets = [{
            name: "seed",
            linkedWidgets: [{ name: "control_after_generate", value: mode }],
        }];
        assert.equal(seedControlModeFromWidgets(widgets), mode);
    }
});

test("missing or unknown seed control mode stays unknown", () => {
    assert.equal(normalizeSeedControlMode("unexpected"), "unknown");
    assert.equal(seedControlModeFromWidgets([{ name: "seed" }]), "unknown");
});
