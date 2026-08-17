import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "director" / "execution_report.py"
spec = importlib.util.spec_from_file_location("director_execution_report_test", path)
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

def test_timing_section_and_helpers():
    assert "Timing" in mod.SECTION_ORDER
    assert mod.fmt_seconds(0) == "0.00s"
    assert mod.fmt_seconds(65.25) == "1m 05.25s"
    report = "Director Report\n\n[Final]\nStatus: SUCCESS"
    updated = mod.append_report_section_lines(report, "Timing", ["Pipeline Total: 1.00s"])
    assert "[Timing]\nPipeline Total: 1.00s" in updated
