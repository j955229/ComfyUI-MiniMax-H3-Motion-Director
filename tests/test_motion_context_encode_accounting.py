from pathlib import Path


def test_motion_context_accepts_separate_audio_latent_candidate_and_times_real_encodes():
    source = Path("director/motion_context.py").read_text(encoding="utf-8")
    assert "context_audio_latent: dict[str, Any] | None = None" in source
    assert "audio_latent_candidate = context_audio_latent if context_audio_latent is not None else context_latent" in source
    assert "video_vae_encode_seconds" in source
    assert "audio_vae_encode_seconds" in source


def test_audio_refresh_wrapper_refreshes_separate_audio_candidate_without_losing_visual_candidate():
    source = Path("director/audio_context_refresh.py").read_text(encoding="utf-8")
    assert 'kwargs.get("context_audio_latent")' in source
    assert 'call_kwargs["context_audio_latent"]' in source
