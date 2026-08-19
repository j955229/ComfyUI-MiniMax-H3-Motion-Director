import torch

from director.refine_latent_stage import sync_h3_keyframe_conditioning


class FakeVAE:
    def decode(self, latent):
        t = int(latent.shape[-3])
        return torch.zeros((t, int(latent.shape[-2]) * 16, int(latent.shape[-1]) * 16, 3))

    def encode(self, images):
        return torch.zeros((1, 24, 1, int(images.shape[1]) // 16, int(images.shape[2]) // 16))


def test_sync_keyframes_keeps_non_keyframe_metadata_unchanged(monkeypatch):
    import nodes

    class Decode:
        def decode(self, vae, latent):
            return (vae.decode(latent["samples"]),)

    class Encode:
        def encode(self, vae, images):
            return ({"samples": vae.encode(images)},)

    monkeypatch.setattr(nodes, "VAEDecode", Decode)
    monkeypatch.setattr(nodes, "VAEEncode", Encode)
    cond_tensor = torch.randn((1, 3))
    ref = torch.randn((2, 2))
    conditioning = [[cond_tensor, {"minimax_refs": [ref]}]]
    out = sync_h3_keyframe_conditioning(conditioning, FakeVAE(), width=128, height=64)
    assert out[0][0] is cond_tensor
    assert torch.equal(out[0][1]["minimax_refs"][0], ref)


def test_sync_keyframes_resizes_spatial_h3_keyframe_latents(monkeypatch):
    import nodes

    class Decode:
        def decode(self, vae, latent):
            return (vae.decode(latent["samples"]),)

    class Encode:
        def encode(self, vae, images):
            return ({"samples": vae.encode(images)},)

    monkeypatch.setattr(nodes, "VAEDecode", Decode)
    monkeypatch.setattr(nodes, "VAEEncode", Encode)
    key = torch.zeros((1, 24, 1, 2, 4))
    conditioning = [[torch.zeros(1), {"minimax_keyframes": [{"frame_index": 0, "latent": key}], "other": "keep"}]]
    out = sync_h3_keyframe_conditioning(conditioning, FakeVAE(), width=128, height=64)
    resized = out[0][1]["minimax_keyframes"][0]["latent"]
    assert resized.shape[-2:] == (4, 8)
    assert out[0][1]["other"] == "keep"
    assert conditioning[0][1]["minimax_keyframes"][0]["latent"].shape[-2:] == (2, 4)


def test_sync_keyframes_leaves_motion_context_for_existing_repin(monkeypatch):
    import nodes

    class Decode:
        def decode(self, vae, latent):
            raise AssertionError("Motion Context keyframe must be left for the existing RGB repin path")

    class Encode:
        def encode(self, vae, images):
            raise AssertionError("Motion Context keyframe must be left for the existing RGB repin path")

    monkeypatch.setattr(nodes, "VAEDecode", Decode)
    monkeypatch.setattr(nodes, "VAEEncode", Encode)
    key = torch.zeros((1, 24, 1, 2, 4))
    conditioning = [[torch.zeros(1), {"minimax_frame_count": 244, "minimax_keyframes": [{"motion_context_index": 0, "latent": key}]}]]
    out = sync_h3_keyframe_conditioning(conditioning, FakeVAE(), width=128, height=64)
    assert out[0][1]["minimax_keyframes"][0]["latent"] is key


def test_sync_keyframes_resizes_five_frame_source_bridge_anchors(monkeypatch):
    import nodes

    class Decode:
        def decode(self, vae, latent):
            return (vae.decode(latent["samples"]),)

    class Encode:
        def encode(self, vae, images):
            return ({"samples": vae.encode(images)},)

    monkeypatch.setattr(nodes, "VAEDecode", Decode)
    monkeypatch.setattr(nodes, "VAEEncode", Encode)
    first = torch.zeros((1, 24, 1, 2, 4))
    last = torch.ones((1, 24, 1, 2, 4))
    conditioning = [[torch.zeros(1), {
        "minimax_frame_count": 5,
        "minimax_keyframes": [
            {"resolved_frame_index": 0, "motion_context_index": 0, "latent": first},
            {"resolved_frame_index": 0, "motion_context_index": 4, "latent": last},
        ],
    }]]
    out = sync_h3_keyframe_conditioning(conditioning, FakeVAE(), width=128, height=64)
    keyframes = out[0][1]["minimax_keyframes"]
    assert keyframes[0]["latent"].shape[-2:] == (4, 8)
    assert keyframes[1]["latent"].shape[-2:] == (4, 8)
