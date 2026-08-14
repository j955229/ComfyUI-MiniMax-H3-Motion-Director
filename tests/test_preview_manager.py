import threading

import torch
from PIL import Image

from _minimax_h3_motion_director_testpkg.director.preview_manager import DirectorPreviewManager
from _minimax_h3_motion_director_testpkg.director.tae_preview import normalize_preview_latent


def test_packed_h3_video_stream_is_restored_from_latent_shapes():
    video_shape = (1, 24, 5, 2, 3)
    video_values = torch.arange(1 * 24 * 5 * 2 * 3, dtype=torch.float32).reshape(1, 1, -1)
    packed = torch.cat((video_values, torch.full((1, 1, 7), -1.0)), dim=2)

    restored = normalize_preview_latent(packed, [video_shape, (1, 8, 7)])

    assert restored.shape == video_shape
    assert torch.equal(restored.reshape(1, 1, -1), video_values)


def test_preview_encoder_failure_does_not_escape_or_stop_later_sampling_callbacks():
    attempted = threading.Event()

    def broken(_job, _config):
        attempted.set()
        raise RuntimeError("encoder exploded")

    manager = DirectorPreviewManager(
        "7",
        {"enabled": True},
        decoder=lambda *_a, **_k: [Image.new("RGB", (8, 8))],
        encoder=broken,
        sender=lambda *_a, **_k: None,
    )
    assert manager.submit(segment_index=0, stage="Generation", step=1, total_steps=8, x0=object())
    assert attempted.wait(2)
    manager.queue.join()
    assert manager.failed == 1
    manager.close()


def test_disabled_preview_does_not_enqueue_but_native_suppression_is_independent():
    manager = DirectorPreviewManager("7", {"enabled": False}, encoder=lambda *_: None)
    assert manager.submit(segment_index=0, stage="Generation", step=1, total_steps=8, x0=object()) is False
    assert manager.queue.empty()
    manager.close()


def test_preview_queue_holds_only_small_cpu_frames_not_the_original_latent():
    release = threading.Event()
    inspected = threading.Event()
    original = torch.zeros((1, 24, 9, 32, 32), device="cpu")

    def encoder(job, _config):
        assert job.frames
        assert all(isinstance(frame, Image.Image) for frame in job.frames)
        assert not hasattr(job, "x0")
        inspected.set()
        release.wait(2)
        return None

    manager = DirectorPreviewManager(
        "7",
        {"enabled": True},
        decoder=lambda *_a, **_k: [Image.new("RGB", (16, 16))],
        encoder=encoder,
    )
    assert manager.submit(segment_index=0, stage="Generation", step=1, total_steps=8, x0=original)
    assert inspected.wait(2)
    release.set()
    manager.queue.join()
    manager.close()


def test_full_preview_queue_drops_without_decoding_or_blocking():
    decoded = 0
    release = threading.Event()

    def decoder(*_args, **_kwargs):
        nonlocal decoded
        decoded += 1
        return [Image.new("RGB", (8, 8))]

    def encoder(_job, _config):
        release.wait(2)
        return None

    manager = DirectorPreviewManager("7", {"enabled": True}, queue_size=1, decoder=decoder, encoder=encoder)
    assert manager.submit(segment_index=0, stage="Generation", step=1, total_steps=8, x0=object())
    # The worker may already have consumed the first item, so fill until the bounded queue rejects one.
    accepted = manager.submit(segment_index=0, stage="Generation", step=2, total_steps=8, x0=object())
    dropped = manager.submit(segment_index=0, stage="Generation", step=3, total_steps=8, x0=object())
    assert accepted is True or dropped is False
    assert manager.dropped >= 1
    assert decoded <= 2
    release.set()
    manager.queue.join()
    manager.close()
