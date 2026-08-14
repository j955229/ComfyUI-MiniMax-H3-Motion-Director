import torch

from _minimax_h3_motion_director_testpkg.director.face_stitch import stitch_faces


def test_rect_stitch_changes_only_tracked_face_region():
    base = torch.zeros((1, 32, 32, 3))
    crop = torch.ones((1, 16, 16, 3))
    transform = {
        "frames": 1, "canvas": (16, 16), "boxes": [(8.0, 8.0, 16.0, 16.0)],
        "face_rect": [(4.0, 4.0, 8.0, 8.0)], "weights": [1.0], "detected": [True],
    }
    result = stitch_faces(base, crop, transform, {
        "mask_mode": "rect", "paste_region": "face_rect", "mask_dilation": 0,
        "feather": 0, "blend": 1, "colour_match": False, "undetected_frames": "fade",
    })
    assert float(result[:, 14:18, 14:18].mean()) > 0.9
    assert float(result[:, :4, :4].max()) == 0
