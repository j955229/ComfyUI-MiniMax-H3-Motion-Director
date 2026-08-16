from pathlib import Path

import torch

from lib.frame_assembly import assemble_frame_chunks, estimate_assembly_bytes


def test_large_assembly_avoids_torch_cat(monkeypatch, tmp_path: Path):
    a = torch.arange(2 * 2 * 3 * 3, dtype=torch.float32).reshape(2, 2, 3, 3)
    b = (100 + torch.arange(1 * 2 * 3 * 3, dtype=torch.float32)).reshape(1, 2, 3, 3)

    def forbidden_cat(*args, **kwargs):
        raise AssertionError("torch.cat must not be used on the file-backed path")

    monkeypatch.setattr(torch, "cat", forbidden_cat)
    out = assemble_frame_chunks(
        [a, b],
        mmap_threshold_bytes=1,
        temp_dir=tmp_path,
    )

    assert out.shape == (3, 2, 3, 3)
    assert torch.equal(out[:2], a)
    assert torch.equal(out[2:], b)
    assert out.is_contiguous()


def test_file_backed_assembly_matches_center_padding(tmp_path: Path):
    small = torch.ones((1, 2, 2, 3), dtype=torch.float32)
    large = torch.full((1, 4, 6, 3), 2.0, dtype=torch.float32)

    out = assemble_frame_chunks(
        [small, large],
        fill=0.5,
        mmap_threshold_bytes=1,
        temp_dir=tmp_path,
    )

    assert out.shape == (2, 4, 6, 3)
    assert torch.all(out[0, 1:3, 2:4] == 1.0)
    mask = torch.ones((4, 6), dtype=torch.bool)
    mask[1:3, 2:4] = False
    assert torch.all(out[0, :, :, 0][mask] == 0.5)
    assert torch.all(out[1] == 2.0)


def test_small_assembly_keeps_normal_in_memory_path(tmp_path: Path):
    a = torch.zeros((1, 2, 2, 3), dtype=torch.float32)
    b = torch.ones((1, 2, 2, 3), dtype=torch.float32)

    out = assemble_frame_chunks(
        [a, b],
        mmap_threshold_bytes=10**9,
        temp_dir=tmp_path,
    )

    assert torch.equal(out, torch.cat([a, b], dim=0))
    assert not list(tmp_path.glob("minimax_h3_assembly_*.bin"))


def test_estimate_matches_issue_2_allocation_size():
    prototype = torch.empty((1, 1360, 768, 3), dtype=torch.float32)
    assert estimate_assembly_bytes([prototype], total_frames_override=362) == 4_537_221_120
