import threading

from _minimax_h3_motion_director_testpkg.director.preview_manager import DirectorPreviewManager


def test_preview_encoder_failure_does_not_escape_or_stop_later_sampling_callbacks():
    attempted = threading.Event()

    def broken(_job, _config):
        attempted.set()
        raise RuntimeError("encoder exploded")

    manager = DirectorPreviewManager("7", {"enabled": True}, encoder=broken, sender=lambda *_a, **_k: None)
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
