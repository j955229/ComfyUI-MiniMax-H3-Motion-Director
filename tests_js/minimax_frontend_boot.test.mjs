import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const timelineUrl = new URL("../web/js/minimax_timeline.js", import.meta.url);
const timeline = await readFile(timelineUrl, "utf8");

test("boot-critical local named imports used by the Director entry module exist", async () => {
    const bootCritical = new Set([
        "./minimax_continuity_ui.mjs",
        "./minimax_director_modal.js",
        "./minimax_context_links.mjs",
        "./minimax_sampling_ui.js",
    ]);
    const pattern = /import\s*\{([^}]*)\}\s*from\s*["'](\.\/[^"']+)["'];/g;
    for (const match of timeline.matchAll(pattern)) {
        const [, rawNames, specifier] = match;
        if (!bootCritical.has(specifier)) continue;
        const module = await import(new URL(specifier, timelineUrl));
        const names = rawNames
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean)
            .map((name) => name.split(/\s+as\s+/)[0].trim());
        for (const name of names) {
            assert.ok(name in module, `${specifier} must export ${name}`);
        }
    }
});

test("Director boot path still installs hidden widgets and continuity UI", () => {
    assert.match(timeline, /async beforeRegisterNodeDef\(nodeType, nodeData\)/);
    assert.match(timeline, /installDirectorContinuityUi\(node\)/);
    assert.match(timeline, /for \(const w of node\.widgets \|\| \[\]\) \{[\s\S]*?HIDDEN_WIDGETS\.includes\(w\.name\)[\s\S]*?hideWidget\(w\)/);
    assert.match(timeline, /setWidgetVisibility\(source, false\)/);
    assert.match(timeline, /setWidgetVisibility\(pin, false\)/);
});
