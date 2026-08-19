import torch

from director.seam_report import build_seam_report_lines


def _audio(samples: int, sr: int = 32000):
    return {"waveform": torch.zeros(1, 1, samples), "sample_rate": sr}


def test_seam_report_surfaces_visual_and_audio_boundary_diagnostics():
    left=torch.zeros(2,4,4,3)
    right=torch.ones(3,4,4,3)
    text="\n".join(build_seam_report_lines([left,right],[_audio(3200),_audio(6400)],fps=24.0))
    assert "S1 -> S2: SUCCESS" in text
    assert "Exported Frames: 2 -> 3" in text
    assert "Mean Abs RGB Jump: 1.000000" in text
    assert "Luma Jump: 1.000000" in text
    assert "Audio Sample Rate: 32000 Hz" in text
    assert "Audio Samples: 3200 -> 6400" in text


def test_seam_report_is_non_destructive_on_unavailable_comparison():
    left=torch.zeros(2,4,4,3); right=torch.ones(3,8,8,3)
    a=left.clone(); b=right.clone()
    text="\n".join(build_seam_report_lines([left,right],[None,None],fps=24.0))
    assert "S1 -> S2: UNAVAILABLE" in text
    assert torch.equal(left,a) and torch.equal(right,b)


def test_seam_report_uses_timeline_slots_for_selective_export():
    chunks=[torch.zeros(1,2,2,3),torch.zeros(1,2,2,3)]
    text="\n".join(build_seam_report_lines(chunks,[None,None],fps=24.0,segment_slots=[1,3]))
    assert "S2 -> S4: SUCCESS" in text
