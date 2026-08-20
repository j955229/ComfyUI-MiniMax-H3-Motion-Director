from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, got {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, *, minimum: int = 1) -> None:
    text = read(path)
    count = text.count(old)
    if count < minimum:
        raise RuntimeError(f"{path}: expected at least {minimum} matches, got {count}: {old!r}")
    write(path, text.replace(old, new))


# ---------------------------------------------------------------------------
# Motion Context: keep waveform refresh semantics, but expose visual validity
# and truthful VAE encode timing.
# ---------------------------------------------------------------------------
replace_once(
    "director/motion_context.py",
    "import logging\nfrom dataclasses import dataclass",
    "import logging\nimport time\nfrom dataclasses import dataclass",
)
replace_once(
    "director/motion_context.py",
    '    pin_renorm_status: str = "OFF"\n',
    '    pin_renorm_status: str = "OFF"\n    video_vae_encode_seconds: float = 0.0\n    audio_vae_encode_seconds: float = 0.0\n',
)
replace_once(
    "director/motion_context.py",
    "    context_latent: dict[str, Any] | None = None,\n    context_end_frame: int | None = None,",
    "    context_latent: dict[str, Any] | None = None,\n    context_visual_latent_valid: bool = True,\n    context_end_frame: int | None = None,",
)
replace_once(
    "director/motion_context.py",
    '    pin_status = "OFF"\n    if visual_enabled and context_latent is not None and not color_reanchor_enabled:\n',
    '    pin_status = "OFF"\n    video_vae_encode_seconds = 0.0\n    audio_vae_encode_seconds = 0.0\n    if (\n        visual_enabled\n        and bool(context_visual_latent_valid)\n        and context_latent is not None\n        and not color_reanchor_enabled\n    ):\n',
)
replace_once(
    "director/motion_context.py",
    "        motion_keyframes, block_count, color_status = _encode_video_context(\n            video_vae,\n            context_frames,\n            width=width,\n            height=height,\n            span=int(context_span),\n            color_reanchor_enabled=bool(color_reanchor_enabled),\n            color_anchor=color_anchor,\n            task_key=task_key,\n        )\n",
    "        _video_encode_started = time.perf_counter()\n        motion_keyframes, block_count, color_status = _encode_video_context(\n            video_vae,\n            context_frames,\n            width=width,\n            height=height,\n            span=int(context_span),\n            color_reanchor_enabled=bool(color_reanchor_enabled),\n            color_anchor=color_anchor,\n            task_key=task_key,\n        )\n        video_vae_encode_seconds = time.perf_counter() - _video_encode_started\n",
)
replace_once(
    "director/motion_context.py",
    "            motion_audio_ref, audio_steps = _encode_audio_context(\n                audio_vae, context_audio, span=int(context_span)\n            )\n            audio_source = \"waveform (fallback)\"\n",
    "            _audio_encode_started = time.perf_counter()\n            motion_audio_ref, audio_steps = _encode_audio_context(\n                audio_vae, context_audio, span=int(context_span)\n            )\n            audio_vae_encode_seconds = time.perf_counter() - _audio_encode_started\n            audio_source = \"waveform (fallback)\"\n",
)
replace_once(
    "director/motion_context.py",
    "        pin_renorm_baseline_source=pin_baseline_source,\n        pin_renorm_status=pin_status,\n    )\n",
    "        pin_renorm_baseline_source=pin_baseline_source,\n        pin_renorm_status=pin_status,\n        video_vae_encode_seconds=video_vae_encode_seconds,\n        audio_vae_encode_seconds=audio_vae_encode_seconds,\n    )\n",
)

# ---------------------------------------------------------------------------
# Postprocess v10: Face Refine becomes part of final segment cache identity.
# ---------------------------------------------------------------------------
replace_once(
    "director/postprocess_config.py",
    "POSTPROCESS_CONFIG_VERSION = 9",
    "POSTPROCESS_CONFIG_VERSION = 10",
)
replace_once(
    "director/postprocess_config.py",
    "    g = dict(normalize_postprocess_config(config)[\"global_refine\"])\n    # Result previews only affect UI decoding cost; they do not change generated pixels/latents.\n    g.pop(\"result_previews_enabled\", None)\n    return {\"global_refine\": g if g[\"enabled\"] else False}\n",
    "    normalized = normalize_postprocess_config(config)\n    g = dict(normalized[\"global_refine\"])\n    f = dict(normalized[\"face_refine\"])\n    # Result previews only affect UI decoding cost; they do not change generated pixels/latents.\n    g.pop(\"result_previews_enabled\", None)\n    return {\n        \"global_refine\": g if g[\"enabled\"] else False,\n        \"face_refine\": f if f[\"enabled\"] else False,\n    }\n",
)

# ---------------------------------------------------------------------------
# Executor lifecycle.
# ---------------------------------------------------------------------------
replace_once(
    "director/executor_core.py",
    "from .face_refine_pipeline import apply_face_refine\n",
    "from .face_refine_pipeline import apply_face_refine\nfrom .face_refine_streaming import select_tracking_history\nfrom .face_refine_validation import validate_face_refine_runtime\n",
)
replace_once(
    "director/executor_core.py",
    '    face_refine_config = postprocess["face_refine"]\n    preview_config = postprocess["preview"]\n',
    '    face_refine_config = postprocess["face_refine"]\n    validate_face_refine_runtime(face_refine_config)\n    preview_config = postprocess["preview"]\n',
)
replace_once(
    "director/executor_core.py",
    '        "context_link_pipeline": "previous_context_link_v2_master_gated",\n',
    '        "context_link_pipeline": "previous_context_link_v2_master_gated",\n        "final_segment_pipeline": "segment_final_face_refine_v10",\n',
)
replace_once(
    "director/executor_core.py",
    "    source_bridge_consumer_slots = {int(right.timeline_index) for _left, right in source_bridge_pairs}\n",
    "    source_bridge_consumer_slots = {int(right.timeline_index) for _left, right in source_bridge_pairs}\n    segment_face_refine_enabled = bool(face_refine_config[\"enabled\"] and not source_bridge_pairs)\n",
)
replace_once(
    "director/executor_core.py",
    "    global_refine_outcomes: dict[int, Any] = {}\n    segment_stage_timings: dict[int, dict[str, float]] = {}\n",
    "    global_refine_outcomes: dict[int, Any] = {}\n    face_refine_outcomes: dict[int, Any] = {}\n    segment_stage_timings: dict[int, dict[str, float]] = {}\n",
)
replace_once(
    "director/executor_core.py",
    "                context_latent=context_entry.latent,\n                context_end_frame=int((context_entry.handoff or {}).get(\"context_end_frame\") or 0) or None,\n",
    "                context_latent=context_entry.latent,\n                context_visual_latent_valid=bool((context_entry.handoff or {}).get(\"visual_latent_valid\", True)),\n                context_end_frame=int((context_entry.handoff or {}).get(\"context_end_frame\") or 0) or None,\n",
)
replace_once(
    "director/executor_core.py",
    "            )\n\n        report_director_progress(\n            node_id, segment_index=progress_index, segment_total=seg_total,\n            phase=\"context_encode\", phase_value=1, phase_max=1, **meta,\n        )\n",
    "            )\n            stage_times[\"context_video_vae\"] = float(motion_info.video_vae_encode_seconds)\n            stage_times[\"context_audio_vae\"] = float(motion_info.audio_vae_encode_seconds)\n\n        report_director_progress(\n            node_id, segment_index=progress_index, segment_total=seg_total,\n            phase=\"context_encode\", phase_value=1, phase_max=1, **meta,\n        )\n",
)
replace_once(
    "director/executor_core.py",
    "                if candidate is not None:\n                    candidate_latent, candidate_handoff = candidate\n                    target_canvas = latent_context_canvas(refine_latent)\n                    candidate_canvas = latent_context_canvas(candidate_latent)\n                    if target_canvas is not None and candidate_canvas == target_canvas:\n",
    "                if candidate is not None:\n                    candidate_latent, candidate_handoff = candidate\n                    target_canvas = latent_context_canvas(refine_latent)\n                    candidate_canvas = latent_context_canvas(candidate_latent)\n                    if (\n                        bool((candidate_handoff or {}).get(\"visual_latent_valid\", True))\n                        and target_canvas is not None\n                        and candidate_canvas == target_canvas\n                    ):\n",
)
replace_once(
    "director/executor_core.py",
    "                context_latent=selected_refine_latent,\n                context_end_frame=int(effective_handoff.get(\"context_end_frame\") or 0) or None,\n",
    "                context_latent=selected_refine_latent,\n                context_visual_latent_valid=bool(\n                    selected_refine_latent is not None\n                    and effective_handoff.get(\"visual_latent_valid\", True)\n                ),\n                context_end_frame=int(effective_handoff.get(\"context_end_frame\") or 0) or None,\n",
)
replace_once(
    "director/executor_core.py",
    "            rebuilt, _ = apply_exported_motion_context(\n",
    "            rebuilt, repin_info = apply_exported_motion_context(\n",
)
replace_once(
    "director/executor_core.py",
    "            )\n            return rebuilt\n\n        global_outcome = apply_global_refine(\n",
    "            )\n            stage_times[\"refine_repin_video_vae\"] = (\n                float(stage_times.get(\"refine_repin_video_vae\", 0.0))\n                + float(repin_info.video_vae_encode_seconds)\n            )\n            stage_times[\"refine_repin_audio_vae\"] = (\n                float(stage_times.get(\"refine_repin_audio_vae\", 0.0))\n                + float(repin_info.audio_vae_encode_seconds)\n            )\n            return rebuilt\n\n        global_outcome = apply_global_refine(\n",
)
replace_once(
    "director/executor_core.py",
    "        chunk = decoded.cpu().float()\n        handoff = {\n",
    "        chunk = decoded.cpu().float()\n        face_pixels_changed = False\n        if segment_face_refine_enabled:\n            history_candidate = completed_outputs.get(int(seg.index) - 1)\n            if history_candidate is None and context_entry is not None:\n                history_candidate = context_entry.frames\n            tracking_history = select_tracking_history(\n                history_candidate, chunk, face_refine_config\n            )\n            _face_started = time.perf_counter()\n            segment_face_outcome = apply_face_refine(\n                face_refine_config,\n                images=chunk,\n                model=model,\n                vae=vae,\n                audio_vae=audio_vae,\n                clip=clip,\n                prompt=positive_prompt,\n                seed=seed,\n                cfg=cfg,\n                steps=int(external_steps or steps),\n                sampler_name=sampler,\n                scheduler=scheduler,\n                shift_video=shift_video,\n                shift_audio=shift_audio,\n                chunk_lengths=[int(chunk.shape[0])],\n                tracking_history=tracking_history,\n                on_phase=_report_sample_phase,\n                on_step_preview=(\n                    (lambda step, total, x0, latent_shapes: _report_step_preview(\n                        step, total, x0, latent_shapes, stage=\"Face Refine\"\n                    )) if live_tae_preview else None\n                ),\n                preview_every=int(preview_config[\"preview_every\"]),\n            )\n            stage_times[\"face_refine\"] = time.perf_counter() - _face_started\n            face_refine_outcomes[timeline_slot] = segment_face_outcome\n            if segment_face_outcome.succeeded:\n                chunk = segment_face_outcome.images.detach().cpu().float()\n                decoded = chunk\n                face_pixels_changed = True\n            elif segment_face_outcome.status in {\"FAILED\", \"NO_FACE\"}:\n                if segment_face_outcome.status == \"FAILED\":\n                    cleanup_segment_vram(enabled=True, unload_models=False)\n                warning_messages.append(\n                    f\"S{timeline_slot + 1}: Face Refine {segment_face_outcome.status}; \"\n                    f\"fallback SEGMENT_RESULT — {segment_face_outcome.error}\"\n                )\n\n        handoff = {\n",
)
replace_once(
    "director/executor_core.py",
    '            "sample_frames": int(num_frames),\n        }\n',
    '            "sample_frames": int(num_frames),\n            "visual_latent_valid": not face_pixels_changed,\n        }\n',
)
replace_once(
    "director/executor_core.py",
    "    face_outcome = apply_face_refine(\n        face_refine_config,\n",
    "    assembled_face_refine_config = dict(face_refine_config)\n    assembled_face_refine_config[\"enabled\"] = bool(\n        face_refine_config[\"enabled\"] and source_bridge_pairs\n    )\n    face_outcome = apply_face_refine(\n        assembled_face_refine_config,\n",
)
replace_once(
    "director/executor_core.py",
    '        f"Enabled: {\'ON\' if face_refine_config[\'enabled\'] else \'OFF\'}",\n        f"Detector: {face_refine_config[\'detector\']}",\n',
    '        f"Enabled: {\'ON\' if face_refine_config[\'enabled\'] else \'OFF\'}",\n        f"Mode: {\'segment-final\' if segment_face_refine_enabled else (\'assembled/source-bridge\' if face_refine_config[\'enabled\'] and source_bridge_pairs else \'disabled\')}",\n        f"Detector: {face_refine_config[\'detector\']}",\n',
)
replace_once(
    "director/executor_core.py",
    '        f"Status: {face_outcome.status}",\n',
    '        f"Status: {\'SEGMENT_FINAL\' if segment_face_refine_enabled else face_outcome.status}",\n',
)
replace_once(
    "director/executor_core.py",
    "    core_seconds = time.perf_counter() - core_started\n",
    "    if segment_face_refine_enabled:\n        for slot, outcome in sorted(face_refine_outcomes.items()):\n            statistics = outcome.statistics or {}\n            execution_report.add(\n                \"Face Refine\",\n                f\"S{slot + 1} Status: {outcome.status}\",\n                f\"S{slot + 1} Canvas: {outcome.canvas or face_refine_config['canvas_mode']}\",\n                (f\"S{slot + 1} Frames: {int(statistics.get('frames') or 0)}\" if statistics else \"\"),\n                (f\"S{slot + 1} Detected: {int(statistics.get('detected') or 0)} / {int(statistics.get('frames') or 0)}\" if statistics else \"\"),\n                (f\"S{slot + 1} Adaptive Strength min/mean/max: {float(statistics.get('denoise_min') or 0):.3f} / {float(statistics.get('denoise_mean') or 0):.3f} / {float(statistics.get('denoise_max') or 0):.3f}\" if 'denoise_mean' in statistics else \"\"),\n                f\"S{slot + 1} Error: {outcome.error}\" if outcome.error else \"\",\n                f\"S{slot + 1} Fallback: {outcome.fallback}\" if outcome.fallback else \"\",\n            )\n\n    core_seconds = time.perf_counter() - core_started\n",
)
replace_once(
    "director/executor_core.py",
    "        known = float(timing.get(\"h3_sampling\", 0.0)) + float(timing.get(\"av_decode\", 0.0)) + global_total\n",
    "        known = (\n            float(timing.get(\"h3_sampling\", 0.0))\n            + float(timing.get(\"av_decode\", 0.0))\n            + float(timing.get(\"face_refine\", 0.0))\n            + global_total\n        )\n",
)
replace_once(
    "director/executor_core.py",
    '            f"  H3 Sampling: {float(timing.get(\'h3_sampling\', 0.0)):.2f}s",\n',
    '            f"  H3 Sampling: {float(timing.get(\'h3_sampling\', 0.0)):.2f}s",\n            f"  Motion Context VideoVAE Encode: {float(timing.get(\'context_video_vae\', 0.0)):.2f}s",\n            f"  Motion Context AudioVAE Refresh: {float(timing.get(\'context_audio_vae\', 0.0)):.2f}s",\n            f"  Global Refine Context Repin VideoVAE: {float(timing.get(\'refine_repin_video_vae\', 0.0)):.2f}s",\n            f"  Global Refine Context Repin AudioVAE: {float(timing.get(\'refine_repin_audio_vae\', 0.0)):.2f}s",\n            f"  Face Refine Total: {float(timing.get(\'face_refine\', 0.0)):.2f}s",\n',
)
replace_once(
    "director/executor_core.py",
    "    else:\n        execution_report.add(\"Timing\", \"Face Refine Total: 0.00s\")\n    execution_report.add(\"Timing\", f\"Core Pipeline: {core_seconds:.2f}s\")\n",
    "    elif segment_face_refine_enabled:\n        execution_report.add(\n            \"Timing\",\n            f\"Face Refine Segment-Final Total: {sum(float(item.get('face_refine', 0.0)) for item in segment_stage_timings.values()):.2f}s\",\n        )\n    else:\n        execution_report.add(\"Timing\", \"Face Refine Total: 0.00s\")\n    execution_report.add(\"Timing\", f\"Core Pipeline: {core_seconds:.2f}s\")\n",
)

# ---------------------------------------------------------------------------
# Frontend v10 + actionable SAM empty state.
# ---------------------------------------------------------------------------
replace_once("web/js/minimax_postprocess_ui.mjs", "    version: 9,", "    version: 10,")
replace_once(
    "web/js/minimax_postprocess_ui.mjs",
    '        no_face_detector: "No face detector model found. face_yolov8m.pt is recommended.",\n',
    '        no_face_detector: "No face detector model found. face_yolov8m.pt is recommended.",\n        no_sam_model: "No compatible Ultralytics SAM .pt model found. Put one in ComfyUI/models/sams.",\n',
)
replace_once(
    "web/js/minimax_postprocess_ui.mjs",
    '        no_face_detector: "未找到人脸检测模型，建议放入 face_yolov8m.pt。",\n',
    '        no_face_detector: "未找到人脸检测模型，建议放入 face_yolov8m.pt。",\n        no_sam_model: "未找到兼容的 Ultralytics SAM .pt 模型。请放到 ComfyUI/models/sams。",\n',
)
replace_once(
    "web/js/minimax_postprocess_ui.mjs",
    '          ${conditional("face_sam_model", field("SAM Model", "face_refine.sam_model", "select", \'<option value="">—</option>\'))}\n',
    '          ${conditional("face_sam_model", field("SAM Model", "face_refine.sam_model", "select", \'<option value="">—</option>\'))}\n          <div class="mmx-post-capability mmx-post-wide" data-conditional="face_sam_model" data-capability="sam_model"></div>\n',
)
replace_once(
    "web/js/minimax_postprocess_ui.mjs",
    '        const vsr = root.querySelector(\'[data-capability="nvidia_rtx_vsr"]\');\n',
    '        const sam = root.querySelector(\'[data-capability="sam_model"]\');\n        if (sam && capabilities) {\n            const models = capabilities.sam_models || [];\n            sam.textContent = models.length ? "" : POST_TEXT[lang].no_sam_model;\n            sam.classList.toggle("bad", !models.length);\n        }\n        const vsr = root.querySelector(\'[data-capability="nvidia_rtx_vsr"]\');\n',
)
replace_once(
    "web/js/minimax_postprocess_ui.mjs",
    '        const vsr = root.querySelector(\'[data-capability="nvidia_rtx_vsr"]\');\n        const ready = !!caps.dependencies?.nvidia_rtx_vsr;\n',
    '        const sam=root.querySelector(\'[data-capability="sam_model"]\');\n        const samModels=caps.sam_models||[];\n        if(sam){sam.textContent=samModels.length?"":POST_TEXT[locale()==="en"?"en":"zh"].no_sam_model;sam.classList.toggle("bad",!samModels.length);}\n        const vsr = root.querySelector(\'[data-capability="nvidia_rtx_vsr"]\');\n        const ready = !!caps.dependencies?.nvidia_rtx_vsr;\n',
)
replace_all("web/js/minimax_timeline.js", "postprocess_output_v9", "postprocess_output_v10")

# Update all JS/Python boot token assertions without broad source rewrites.
for candidate in [
    ROOT / "web/js/tests/minimax_postprocess_bootstrap.test.mjs",
    ROOT / "tests/test_postprocess_boot_token_v9.py",
]:
    if candidate.exists():
        text = candidate.read_text(encoding="utf-8").replace("postprocess_output_v9", "postprocess_output_v10").replace("is_v9", "is_v10")
        candidate.write_text(text, encoding="utf-8")
old_boot = ROOT / "tests/test_postprocess_boot_token_v9.py"
new_boot = ROOT / "tests/test_postprocess_boot_token_v10.py"
if old_boot.exists():
    old_boot.replace(new_boot)

# ---------------------------------------------------------------------------
# Focused regression contracts.
# ---------------------------------------------------------------------------
write(
    "tests/test_motion_context_visual_validity.py",
    '''from pathlib import Path\n\n\ndef test_motion_context_visual_validity_keeps_audio_path_independent():\n    source = Path("director/motion_context.py").read_text(encoding="utf-8")\n    assert "context_visual_latent_valid: bool = True" in source\n    assert "and bool(context_visual_latent_valid)" in source\n    audio_branch = source[source.index("if audio_enabled:"):source.index("merged, removed, preserved = merge_motion_conditioning")]\n    assert "if context_latent is not None:" in audio_branch\n    assert "context_visual_latent_valid" not in audio_branch\n\n\ndef test_motion_context_reports_real_encode_timings():\n    source = Path("director/motion_context.py").read_text(encoding="utf-8")\n    assert "video_vae_encode_seconds" in source\n    assert "audio_vae_encode_seconds" in source\n    assert "_video_encode_started = time.perf_counter()" in source\n    assert "_audio_encode_started = time.perf_counter()" in source\n''',
)
write(
    "tests/test_executor_face_refine_handoff_contract.py",
    '''from pathlib import Path\n\n\ndef test_segment_final_face_refine_precedes_cache_and_handoff():\n    source = Path("director/executor_core.py").read_text(encoding="utf-8")\n    segment_face = source.index("if segment_face_refine_enabled:")\n    cache_write = source.index("write_segment_cache_if_required(", segment_face)\n    completed = source.index("completed_contexts[timeline_slot] = CachedMotionContext", segment_face)\n    assert segment_face < cache_write < completed\n    assert "tracking_history=tracking_history" in source[segment_face:cache_write]\n    assert '"visual_latent_valid": not face_pixels_changed' in source[segment_face:cache_write]\n\n\ndef test_source_bridge_keeps_assembled_face_refine_exception():\n    source = Path("director/executor_core.py").read_text(encoding="utf-8")\n    assert 'segment_face_refine_enabled = bool(face_refine_config["enabled"] and not source_bridge_pairs)' in source\n    assert 'assembled_face_refine_config["enabled"] = bool(' in source\n    assert 'face_refine_config["enabled"] and source_bridge_pairs' in source\n\n\ndef test_face_refine_visual_latent_invalidity_is_consumed_by_motion_context():\n    source = Path("director/executor_core.py").read_text(encoding="utf-8")\n    assert "context_visual_latent_valid=bool((context_entry.handoff or {}).get" in source\n    assert 'candidate_handoff or {}).get("visual_latent_valid", True)' in source\n    assert "validate_face_refine_runtime(face_refine_config)" in source\n\n\ndef test_timing_report_exposes_context_vae_costs():\n    source = Path("director/executor_core.py").read_text(encoding="utf-8")\n    assert "Motion Context VideoVAE Encode" in source\n    assert "Motion Context AudioVAE Refresh" in source\n    assert "Global Refine Context Repin VideoVAE" in source\n    assert "Face Refine Segment-Final Total" in source\n''',
)

# Make the boot-token test explicitly v10 even if its function name had drifted.
boot = ROOT / "tests/test_postprocess_boot_token_v10.py"
if boot.exists():
    text = boot.read_text(encoding="utf-8")
    if "postprocess_output_v10" not in text:
        raise RuntimeError("v10 boot token assertion was not updated")

# Final sanity assertions before the workflow runs tests.
assert "POSTPROCESS_CONFIG_VERSION = 10" in read("director/postprocess_config.py")
assert "version: 10" in read("web/js/minimax_postprocess_ui.mjs")
assert "postprocess_output_v10" in read("web/js/minimax_timeline.js")
assert "visual_latent_valid" in read("director/executor_core.py")
assert "context_visual_latent_valid" in read("director/motion_context.py")
