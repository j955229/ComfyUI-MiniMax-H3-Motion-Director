from pathlib import Path

path = Path('web/js/minimax_timeline.js')
text = path.read_text(encoding='utf-8')

old_import = 'from "./minimax_continuity_ui.mjs?boot=director_ui_v3";'
new_import = 'from "./minimax_continuity_ui.mjs?boot=director_ui_v4";'
if old_import in text:
    text = text.replace(old_import, new_import, 1)
elif new_import not in text:
    raise SystemExit('continuity UI import boot key not found')

old = '''                    this.mixedTimeline = normalizeMixedTimeline(next);\n                    this.mixedTimeline.output = this.mixedTimeline.output || {};\n'''
new = '''                    this.mixedTimeline = normalizeMixedTimeline(next);\n                    this.mixedTimeline.output = this.mixedTimeline.output || {};\n                    // Mixed segment count controls which global continuity tuning\n                    // widgets are visible on the outer Director node. Refresh it\n                    // immediately when segments are added/removed or continuity\n                    // state changes instead of waiting for another task switch.\n                    refreshDirectorContinuityUi(this.node, this);\n'''
if old in text:
    text = text.replace(old, new, 1)
elif 'Mixed segment count controls which global continuity tuning' not in text:
    raise SystemExit('Mixed onChange insertion point not found')

path.write_text(text, encoding='utf-8')
print('Mixed Context Length outer-node visibility refresh patched')
