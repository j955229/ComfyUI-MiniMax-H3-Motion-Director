from pathlib import Path

path = Path('director/mixed_schema.py')
text = path.read_text(encoding='utf-8')
old = '''    # Explicit I2V start-state conditioning owns the visual start frame. Audio\n    # inheritance remains independent.\n    if normalize_mixed_mode(segment.get("mode")) == "i2v":\n        inputs = segment.get("inputs") or {}\n        has_static_start = bool(inputs.get("startFrame") or inputs.get("start_frame"))\n        has_result_start = any(\n            str(ref.get("role") or "") == "i2v_start"\n            for ref in (inputs.get("resultRefs") or inputs.get("result_refs") or [])\n            if isinstance(ref, Mapping)\n        )\n        if has_static_start or has_result_start:\n            visual = False\n'''
new = '''    # A newly uploaded/static I2V start image is an explicit visual reset.\n    # A Mixed Segment Result start frame is different: it is sampled from an\n    # earlier generated segment and may intentionally be combined with that\n    # previous segment's Motion Context. Runtime materialization clears\n    # ``source_clip`` for result-backed I2V, so the executor preserves the\n    # requested visual ContextLink for that continuation case.\n    if normalize_mixed_mode(segment.get("mode")) == "i2v":\n        inputs = segment.get("inputs") or {}\n        has_static_start = bool(inputs.get("startFrame") or inputs.get("start_frame"))\n        if has_static_start:\n            visual = False\n'''
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected one I2V continuity policy block, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Mixed I2V Segment Result can now retain requested Motion Context')
