import importlib.util
from types import SimpleNamespace
from pathlib import Path
import torch
import sys

PATH = Path(__file__).parents[1] / "director" / "audio_drive.py"
spec = importlib.util.spec_from_file_location("audio_drive_under_test", PATH)
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


def audio(asset_id, seconds=5.0, sr=10, channels=1, index=0):
    wave = torch.arange(int(seconds * sr), dtype=torch.float32).reshape(1, 1, -1)
    if channels > 1:
        wave = wave.repeat(1, channels, 1)
    return SimpleNamespace(index=index, asset_id=asset_id, audio={"waveform": wave, "sample_rate": sr})


def segment(asset_items, prompt="scene", task="r2v", seg_id="s1", frames=240):
    return SimpleNamespace(
        index=0, ui_index=0, timeline_index=0, task_key=task, prompt=prompt,
        ref_audios=asset_items, reference_tags={("audio", a.asset_id): f"<Audio {i+1}>" for i, a in enumerate(asset_items)},
        start_frame=0, end_frame=frames, frame_count=frames,
    )


def plan(seg, roles, fps=24.0, legacy=None):
    raw = {"segments": [{"id": "s1"}], "audioRoles": roles, "output": {"audioMode": "generate"}}
    if legacy is not None:
        raw["dialogueDrive"] = legacy
    return SimpleNamespace(
        segments=[seg], raw=raw,
        edit_mode="segment", frame_rate=fps, global_task_key=seg.task_key, run_indices=None,
    )


def test_retired_dialogue_role_becomes_normal_reference_and_keeps_editor_trim():
    assert not hasattr(mod, "AUDIO_ROLE_DIALOGUE_DRIVE")
    src = audio("a", 6, sr=10)
    original = src.audio["waveform"].clone()
    seg = segment([src], prompt="scene")
    roles = {"version": 1, "segments": {"s1": {
        "a": {"role": "dialogue_drive", "sourceDuration": 6, "trimStart": 1, "trimEnd": 5, "timelineStart": 3},
    }}}
    active = mod.prepare_audio_role_plan(plan(seg, roles))
    assert active == []
    assert seg.prompt == "scene"
    assert torch.equal(src.audio["waveform"], original[..., 10:50])
    assert torch.equal(getattr(src, "_mmx_audio_role_base_audio")["waveform"], original)


def test_legacy_dialogue_drive_state_is_ignored():
    src = audio("a", 5, sr=10)
    original = src.audio["waveform"].clone()
    seg = segment([src], prompt="scene")
    p = plan(seg, {"version": 2, "segments": {"s1": {}}}, legacy={"segmentAssetIds": {"s1": "a"}})
    active = mod.prepare_audio_role_plan(p)
    assert active == []
    assert seg.prompt == "scene"
    assert torch.equal(src.audio["waveform"], original)


def test_overlapping_exact_drive_intervals_fail_before_sampling():
    a = audio("a", 6, sr=10)
    b = audio("b", 5, sr=10, index=1)
    seg = segment([a, b])
    roles = {"version": 2, "segments": {"s1": {
        "a": {"role": "audio_drive", "sourceDuration": 6, "trimStart": 0, "trimEnd": 6, "timelineStart": 0},
        "b": {"role": "audio_drive", "sourceDuration": 5, "trimStart": 0, "trimEnd": 5, "timelineStart": 5},
    }}}
    try:
        mod.prepare_audio_role_plan(plan(seg, roles))
    except ValueError as exc:
        assert "overlap" in str(exc).lower()
    else:
        raise AssertionError("expected overlap failure")


def test_exact_audio_overlay_replaces_interval_and_preserves_source_samples():
    assert hasattr(mod, "apply_exact_audio_drive_outputs")
    src = audio("a", 2, sr=10)
    seg = segment([src], frames=100)
    roles = {"version": 2, "segments": {"s1": {
        "a": {"role": "audio_drive", "sourceDuration": 2, "trimStart": 0, "trimEnd": 2, "timelineStart": 3},
    }}}
    p = plan(seg, roles, fps=10.0)
    mod.prepare_audio_role_plan(p)
    generated = {"waveform": torch.full((1, 1, 100), -1.0), "sample_rate": 10}
    outputs = mod.apply_exact_audio_drive_outputs(p, [generated], [torch.zeros(100, 1, 1, 3)], export_segments=True)
    out = outputs[0]["waveform"]
    assert torch.equal(out[..., 30:50], src.audio["waveform"])
    assert torch.all(out[..., :30] == -1)
    assert torch.all(out[..., 50:] == -1)


def test_latent_mask_locks_only_exact_drive_interval():
    assert hasattr(mod, "build_audio_drive_latent_mask")
    mask = mod.build_audio_drive_latent_mask(20, [(2.0, 4.0)], total_seconds=10.0, prefix_seconds=0.0)
    assert mask.shape[-1] == 20
    assert torch.all(mask[..., :4] == 1)
    assert torch.all(mask[..., 4:8] == 0)
    assert torch.all(mask[..., 8:] == 1)


def test_multiple_exact_drives_must_share_sample_rate_for_exact_pcm():
    a = audio("a", 5, sr=10)
    b = audio("b", 5, sr=20, index=1)
    seg = segment([a, b])
    roles = {"version": 2, "segments": {"s1": {
        "a": {"role": "audio_drive", "sourceDuration": 5, "trimStart": 0, "trimEnd": 5, "timelineStart": 0},
        "b": {"role": "audio_drive", "sourceDuration": 5, "trimStart": 0, "trimEnd": 5, "timelineStart": 5},
    }}}
    try:
        mod.prepare_audio_role_plan(plan(seg, roles))
    except ValueError as exc:
        assert "sample rate" in str(exc).lower()
    else:
        raise AssertionError("expected sample-rate validation failure")


def test_exact_drive_injection_replaces_only_masked_audio_latent_range(monkeypatch):
    import types
    class Nested:
        def __init__(self, parts): self.parts = tuple(parts); self.is_nested = True
        def unbind(self): return self.parts
    comfy = types.ModuleType("comfy")
    nested_mod = types.ModuleType("comfy.nested_tensor")
    nested_mod.NestedTensor = Nested
    comfy.nested_tensor = nested_mod
    monkeypatch.setitem(sys.modules, "comfy", comfy)
    monkeypatch.setitem(sys.modules, "comfy.nested_tensor", nested_mod)

    src = audio("a", 2, sr=10)
    seg = segment([src], frames=100)
    roles = {"version": 2, "segments": {"s1": {
        "a": {"role": "audio_drive", "sourceDuration": 2, "trimStart": 0, "trimEnd": 2, "timelineStart": 3},
    }}}
    p = plan(seg, roles, fps=10.0)
    mod.prepare_audio_role_plan(p)

    class FakeVAE:
        audio_sample_rate = 10
        def encode(self, wave):
            return torch.full((1, 2, 2, 20), 7.0)

    video = torch.zeros((1, 1, 100, 1, 1))
    template = torch.ones((1, 2, 2, 20))
    latent = {"samples": Nested((video, template))}
    state = mod._RuntimeState(plan=p, audio_vae=FakeVAE(), segment=seg)
    mod._inject_audio_drive(latent, None, state)
    _, driven = latent["samples"].unbind()
    _, mask = latent["noise_mask"].unbind()
    assert torch.all(driven[..., :6] == 1)
    assert torch.all(driven[..., 6:10] == 7)
    assert torch.all(driven[..., 10:] == 1)
    assert torch.all(mask[..., :6] == 1)
    assert torch.all(mask[..., 6:10] == 0)
    assert torch.all(mask[..., 10:] == 1)


def test_normal_reference_non_destructive_editor_trim_affects_only_runtime_reference():
    src = audio("a", 5, sr=10)
    original = src.audio["waveform"].clone()
    seg = segment([src])
    roles = {"version": 2, "segments": {"s1": {
        "a": {"role": "reference", "sourceDuration": 5, "trimStart": 1, "trimEnd": 4, "timelineStart": 0},
    }}}
    mod.prepare_audio_role_plan(plan(seg, roles))
    assert src.audio["waveform"].shape[-1] == 30
    assert torch.equal(src.audio["waveform"], original[..., 10:40])
    assert torch.equal(getattr(src, "_mmx_audio_role_base_audio")["waveform"], original)
