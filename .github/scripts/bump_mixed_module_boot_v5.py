from pathlib import Path

replacements = {
    "web/js/minimax_timeline.js": [
        ('from "./minimax_mixed_ui.mjs?boot=mixed_native_v3";', 'from "./minimax_mixed_ui.mjs?boot=mixed_native_v5";'),
        ('from "./minimax_mixed_state.mjs?boot=mixed_native_v3";', 'from "./minimax_mixed_state.mjs?boot=mixed_native_v5";'),
    ],
    "web/js/minimax_mixed_ui.mjs": [
        ('from "./minimax_mixed_ui_v2.mjs?boot=native_inputs_v1";', 'from "./minimax_mixed_ui_v2.mjs?boot=mixed_native_v5";'),
    ],
    "web/js/minimax_mixed_ui_v2.mjs": [
        ('} from "./minimax_mixed_state.mjs";', '} from "./minimax_mixed_state.mjs?boot=mixed_native_v5";'),
        ('from "./minimax_mixed_native_inputs.mjs?boot=native_inputs_v1";', 'from "./minimax_mixed_native_inputs.mjs?boot=mixed_native_v5";'),
    ],
    "web/js/minimax_mixed_native_inputs.mjs": [
        ('from "./minimax_mixed_state.mjs";', 'from "./minimax_mixed_state.mjs?boot=mixed_native_v5";'),
    ],
}

for filename, pairs in replacements.items():
    path = Path(filename)
    text = path.read_text(encoding="utf-8")
    for old, new in pairs:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f"{filename}: expected one occurrence of {old!r}, got {count}")
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")

print("Mixed module boot chain bumped to mixed_native_v5")
