import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
INIT = ROOT / "__init__.py"


def test_public_node_registration_is_reduced_to_three_nodes():
    text = INIT.read_text(encoding="utf-8")
    assert '"MiniMaxH3MotionDirector": MiniMaxH3MotionDirector' in text
    assert '"MiniMaxH3MotionDirectorInputs": MiniMaxH3MotionDirectorInputs' in text
    assert '"MiniMaxH3MotionDirectorAssets": MiniMaxH3MotionDirectorAssets' in text

    for legacy in (
        "MiniMaxH3MotionDirectorConditioning",
        "MiniMaxH3MotionDirectorPlannerConditioning",
        "MiniMaxH3MotionDirectorGroupImageToVideo",
        "MiniMaxH3MotionDirectorGroupReferenceToVideo",
        "MiniMaxH3MotionDirectorGroupsCombine",
    ):
        assert legacy not in text
