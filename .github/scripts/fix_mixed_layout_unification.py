from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, got {count}")
    return text.replace(old, new, 1)


ui = Path("web/js/minimax_mixed_ui_v2.mjs")
s = ui.read_text(encoding="utf-8")
s = replace_once(
    s,
    ".mmx-mixed-root{height:100%;min-height:0;display:grid;grid-template-rows:minmax(160px,34%) minmax(0,1fr);gap:8px;padding:8px;box-sizing:border-box;font-family:inherit;color:inherit}\n"
    ".mmx-mixed-timeline-panel{min-height:0;overflow:hidden}.mmx-mixed-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mmx-mixed-toolbar .mmx-spacer{flex:1}\n"
    ".mmx-mixed-cards{display:flex;gap:7px;overflow:auto;min-height:0;padding:2px;align-items:stretch}.mmx-mixed-card{flex:0 0 190px;min-height:112px;cursor:pointer;position:relative}",
    ".mmx-mixed-root{min-height:0;display:flex;flex-direction:column;gap:8px;padding:0;box-sizing:border-box;font-family:inherit;color:inherit}\n"
    ".mmx-mixed-timeline-panel{flex:0 0 auto;min-height:0;overflow:hidden}.mmx-mixed-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mmx-mixed-toolbar .mmx-spacer{flex:1}\n"
    ".mmx-mixed-cards{display:flex;gap:7px;overflow-x:auto;overflow-y:hidden;min-height:0;padding:2px;align-items:stretch}.mmx-mixed-card{flex:1 0 190px;min-width:190px;min-height:112px;cursor:pointer;position:relative}",
    "Mixed segment-strip CSS",
)
s = replace_once(
    s,
    ".mmx-mixed-editor-grid{min-height:0;display:grid;",
    ".mmx-mixed-editor-grid{flex:1 1 auto;min-height:0;display:grid;",
    "Mixed editor flex CSS",
)
s = replace_once(
    s,
    "@media(max-width:768px){.mmx-mixed-editor-grid{grid-template-columns:1fr}.mmx-mixed-root{grid-template-rows:minmax(145px,30%) minmax(0,1fr)}.mmx-mixed-card{flex-basis:165px}",
    "@media(max-width:768px){.mmx-mixed-editor-grid{grid-template-columns:1fr}.mmx-mixed-card{flex-basis:165px;min-width:165px}",
    "Mixed mobile CSS",
)
ui.write_text(s, encoding="utf-8")


timeline = Path("web/js/minimax_timeline.js")
s = timeline.read_text(encoding="utf-8")
s = replace_once(
    s,
    '''    _setMixedBodiesActive(active) {
        const host = this._mixedPanelHost;
        for (const child of Array.from(this.mainBody?.children || [])) {
            if (child === host || child === this.outputBarEl) continue;
            child.hidden = !!active;
        }
        for (const element of this.root?.querySelectorAll?.(
            ".bd-actions, .bd-smart-split-msg, .bd-external-groups-msg",
        ) || []) {
            element.hidden = !!active;
        }
        const continuity = this.segmentContinuityWrap
            || this.root?.querySelector?.('[data-r="segment-continuity-wrap"]');
        const common = this.r2vCommonToggle
            || this.root?.querySelector?.('[data-a="r2v-common-toggle"]');
        const audio = this.outAudioWrap
            || this.root?.querySelector?.('[data-r="out-audio-wrap"]');
        if (continuity) continuity.hidden = !!active;
        if (common) common.hidden = !!active;
        if (audio) audio.hidden = !!active;
        if (this._mixedPanelHost) this._mixedPanelHost.hidden = !active;
    }
''',
    '''    _setMixedBodiesActive(active) {
        const host = this._mixedPanelHost;
        for (const child of Array.from(this.mainBody?.children || [])) {
            if (child === host || child === this.outputBarEl) continue;
            child.classList?.toggle("hidden", !!active);
        }
        for (const element of this.root?.querySelectorAll?.(
            ".bd-actions, .bd-smart-split-msg, .bd-external-groups-msg",
        ) || []) {
            element.classList?.toggle("hidden", !!active);
        }
        // Legacy prompt/reference panels are nested in some standalone modes,
        // so direct-child isolation alone is insufficient.
        for (const element of [this.globalPanel, this.segmentPanel]) {
            element?.classList?.toggle("hidden", !!active);
        }
        const continuity = this.segmentContinuityWrap
            || this.root?.querySelector?.('[data-r="segment-continuity-wrap"]');
        const common = this.r2vCommonToggle
            || this.root?.querySelector?.('[data-a="r2v-common-toggle"]');
        const audio = this.outAudioWrap
            || this.root?.querySelector?.('[data-r="out-audio-wrap"]');
        continuity?.classList?.toggle("hidden", !!active);
        common?.classList?.toggle("hidden", !!active);
        audio?.classList?.toggle("hidden", !!active);
        this.outputBarEl?.classList?.remove("hidden");
        this._mixedPanelHost?.classList?.toggle("hidden", !active);
    }
''',
    "Mixed body isolation",
)
s = replace_once(
    s,
    '''        if (this.outputBarEl?.parentElement === parent) parent.insertBefore(host, this.outputBarEl);
        else parent.appendChild(host);
''',
    '''        if (this.outputBarEl?.parentElement === parent) {
            // Match the standalone Director hierarchy: toolbar -> output -> body.
            parent.insertBefore(this.outputBarEl, parent.firstChild);
            this.outputBarEl.after(host);
        } else {
            parent.appendChild(host);
        }
''',
    "Mixed host placement",
)
timeline.write_text(s, encoding="utf-8")


browser = Path("web/js/tests/minimax_mixed_browser.test.mjs")
s = browser.read_text(encoding="utf-8")
s = replace_once(
    s,
    'assert.ok(controller.root.querySelector(".bd-select"), "Mixed selects must reuse Director .bd-select styling");\n',
    '''assert.ok(controller.root.querySelector(".bd-select"), "Mixed selects must reuse Director .bd-select styling");
const mixedStyle = document.getElementById("mmx-mixed-mode-integrated-styles")?.textContent || "";
assert.match(mixedStyle, /\\.mmx-mixed-cards\\{[^}]*overflow-x:auto;overflow-y:hidden/,
    "Mixed segment strip must scroll horizontally only");
assert.match(mixedStyle, /\\.mmx-mixed-card\\{[^}]*flex:1 0 190px;min-width:190px/,
    "a small number of Mixed segment cards must expand to use available width");
assert.doesNotMatch(mixedStyle, /\\.mmx-mixed-cards\\{[^}]*overflow:auto/,
    "Mixed segment strip must not enable an unnecessary vertical scrollbar");
''',
    "Mixed browser layout test",
)
browser.write_text(s, encoding="utf-8")


contract = Path("web/js/tests/minimax_mixed_native_contract.test.mjs")
s = contract.read_text(encoding="utf-8")
if "timelineSource" not in s:
    raise SystemExit("native contract has no timelineSource variable")
s = replace_once(
    s,
    'console.log("native Mixed integration contract passed");\n',
    '''assert.match(timelineSource, /parent\\.insertBefore\\(this\\.outputBarEl, parent\\.firstChild\\);\\s*this\\.outputBarEl\\.after\\(host\\);/,
    "Mixed output controls must occupy the same top position as standalone Director modes");
assert.match(timelineSource, /child\\.classList\\?\\.toggle\\(\"hidden\", !!active\\)/,
    "Mixed must isolate legacy Director bodies with the project hidden class");
assert.match(timelineSource, /this\\.globalPanel, this\\.segmentPanel/,
    "standalone prompt/reference panels must be explicitly isolated from Mixed");

console.log("native Mixed integration contract passed");
''',
    "Mixed native layout tests",
)
contract.write_text(s, encoding="utf-8")
