import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "web" / "js" / "minimax_director_inputs.js"


def test_frontend_extension_binds_inputs_to_director_and_enforces_group_locks():
    text = SOURCE.read_text(encoding="utf-8")
    assert 'name: "MiniMaxH3.MotionDirector.UnifiedInputs"' in text
    assert 'MiniMaxH3MotionDirectorInputs' in text
    assert 'director_inputs' in text
    assert 'desiredDirectorInputSockets' in text
    assert 'timelineGroupHasInternalMedia' in text
    assert 'mmx-external-assets-locked' in text
    assert 'disconnectInput' in text
