import importlib
import sys
import types


def _install_stubs():
    core = types.ModuleType("director.core_sampling")
    calls = {"sample": [], "upscale": [], "sync": []}

    def sample_single_stage(**kwargs):
        calls["sample"].append(kwargs)
        return kwargs["latent"]

    core.sample_single_stage = sample_single_stage
    sys.modules["director.core_sampling"] = core

    cfg = types.ModuleType("director.postprocess_config")
    cfg.refine_passes_for = lambda c: int(c.get("passes", 1))
    cfg.refine_pass_settings_for = lambda c, first: [
        (float(c.get("denoise", 0.25)), int(c.get("steps") or 8))
    ] * int(c.get("passes", 1))
    cfg.refine_steps_for = lambda c, first: int(c.get("steps") or 8)
    cfg.refine_seed_for = lambda c, seed, i=0: int(seed) + (i if c.get("seed_mode") == "offset" else 0)
    cfg.resolve_upscale_target = lambda c, w, h: (int(c.get("width", w)), int(c.get("height", h)))
    cfg.resolve_vsr_quality_name = lambda c: "HIGHBITRATE_HIGH"
    sys.modules["director.postprocess_config"] = cfg

    rtx = types.ModuleType("director.rtx_deblur")

    class RTXDeblurOutcome:
        pass

    rtx.RTXDeblurOutcome = RTXDeblurOutcome
    rtx.apply_rtx_deblur = lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("deblur should not run")
    )
    sys.modules["director.rtx_deblur"] = rtx

    learned = types.ModuleType("director.h3_learned_latent")

    def upscale(latent, **kwargs):
        calls["upscale"].append(kwargs)
        out = dict(latent)
        out["samples"] = "upscaled"
        return out

    learned.upscale_h3_av_latent = upscale
    sys.modules["director.h3_learned_latent"] = learned

    mask = types.ModuleType("director.h3_noise_mask")
    mask.remap_h3_noise_mask = lambda value, **kwargs: value

    def with_noise_mask(latent, value):
        out = dict(latent)
        if value is None:
            out.pop("noise_mask", None)
        else:
            out["noise_mask"] = value
        return out

    mask.with_noise_mask = with_noise_mask
    sys.modules["director.h3_noise_mask"] = mask

    sync = types.ModuleType("director.refine_latent_stage")

    def sync_h3_keyframe_conditioning(cond, vae, **kwargs):
        calls["sync"].append(kwargs)
        return cond

    sync.sync_h3_keyframe_conditioning = sync_h3_keyframe_conditioning
    sys.modules["director.refine_latent_stage"] = sync
    return calls


def _load_module():
    sys.modules.pop("director.refine_sampling", None)
    return importlib.import_module("director.refine_sampling")


def test_learned_latent_path_skips_pixel_decode_encode(monkeypatch):
    calls = _install_stubs()
    mod = _load_module()
    monkeypatch.setattr(mod, "_video_latent_canvas", lambda samples: (64, 32))
    monkeypatch.setattr(
        mod,
        "_decode_video",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("pixel decode must not run")),
    )
    monkeypatch.setattr(
        mod,
        "_encode_video",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("pixel encode must not run")),
    )
    source = {"samples": "source", "noise_mask": "native-mask"}
    out = mod.apply_global_refine(
        {
            "enabled": True,
            "mode": "upscale",
            "upscale_method": "h3_learned_latent",
            "latent_upscale_model": "h3.safetensors",
            "latent_upscale_variant": "3d",
            "latent_upscale_precision": "fp16",
            "latent_upscale_device": "cuda",
            "width": 128,
            "height": 64,
            "second_sampling_enabled": False,
        },
        task_key="t2v",
        samples=source,
        model=object(),
        vae=object(),
        positive=[],
        negative=[],
        seed=42,
        cfg=1.0,
        first_steps=8,
        sampler_name="euler",
        scheduler="normal",
        shift_video=0.0,
        shift_audio=0.0,
        director_width=64,
        director_height=32,
    )
    assert out.succeeded
    assert out.samples["samples"] == "upscaled"
    assert out.samples["noise_mask"] == "native-mask"
    assert calls["upscale"][0]["width"] == 128
    assert calls["upscale"][0]["height"] == 64
    assert calls["sync"] == [{"width": 128, "height": 64}]


def test_plain_second_sampling_keeps_existing_audio_drive_mask(monkeypatch):
    calls = _install_stubs()
    mod = _load_module()
    monkeypatch.setattr(mod, "_emit_refine_result_preview", lambda *a, **k: None)
    monkeypatch.setattr(mod, "_selected_refine_model", lambda cfg, model: (model, "Follow First Pass"))
    source = {"samples": "source", "noise_mask": "audio-drive-mask"}
    out = mod.apply_global_refine(
        {
            "enabled": True,
            "mode": "refine",
            "second_sampling_enabled": True,
            "passes": 1,
            "steps": 8,
            "denoise": 0.25,
        },
        task_key="r2v",
        samples=source,
        model=object(),
        vae=object(),
        positive=[],
        negative=[],
        seed=7,
        cfg=1.0,
        first_steps=8,
        sampler_name="euler",
        scheduler="normal",
        shift_video=0.0,
        shift_audio=0.0,
        director_width=64,
        director_height=32,
        preserve_noise_mask=False,
    )
    assert out.succeeded
    assert calls["sample"][0]["latent"]["noise_mask"] == "audio-drive-mask"


def test_learned_latent_plus_deblur_fails_back_without_silent_pixel_fallback():
    calls = _install_stubs()
    mod = _load_module()
    source = {"samples": "source"}
    out = mod.apply_global_refine(
        {
            "enabled": True,
            "mode": "upscale",
            "upscale_method": "h3_learned_latent",
            "latent_upscale_model": "h3.safetensors",
            "rtx_deblur_enabled": True,
            "second_sampling_enabled": False,
        },
        task_key="t2v",
        samples=source,
        model=object(),
        vae=object(),
        positive=[],
        negative=[],
        seed=1,
        cfg=1.0,
        first_steps=8,
        sampler_name="euler",
        scheduler="normal",
        shift_video=0.0,
        shift_audio=0.0,
        director_width=64,
        director_height=32,
    )
    assert out.status == "FAILED"
    assert out.fallback == "FIRST_PASS_RESULT"
    assert out.samples is source
    assert calls["upscale"] == []
    assert "RTX Deblur" in out.error
