"""Minimal interpreter builds (Buildroot, Yocto) ship without sqlite3: the gateway must
still import and run, with LLM usage simply unrecorded."""

from __future__ import annotations

import os
import subprocess
import sys
import textwrap
from pathlib import Path

_SCRIPT = textwrap.dedent(
    """
    import importlib.abc, sys

    class NoSqlite(importlib.abc.MetaPathFinder):
        def find_spec(self, name, path, target=None):
            if name in ("sqlite3", "_sqlite3") or name.startswith("sqlite3."):
                raise ModuleNotFoundError(f"No module named {name!r}", name=name)

    sys.meta_path.insert(0, NoSqlite())
    import nanobot.agent.loop, nanobot.cli.gateway_runtime, nanobot.webui.settings_system
    from nanobot.llm_usage import empty_usage_payload, llm_usage_payload, record_llm_call
    from nanobot.llm_usage.models import LLMCallRecord

    call = LLMCallRecord(
        started_at_ms=0, duration_ms=1, provider="openai", model="m",
        source="user", stream=False, finish_reason="stop",
    )
    record_llm_call(call)
    record_llm_call(call)
    assert llm_usage_payload() == empty_usage_payload()
    print("ran without sqlite3")
    """
)


def test_the_gateway_runs_on_an_interpreter_without_sqlite3(tmp_path: Path) -> None:
    done = subprocess.run(
        [sys.executable, "-c", _SCRIPT],
        capture_output=True,
        text=True,
        env={**os.environ, "HOME": str(tmp_path)},
        timeout=120,
    )
    assert done.returncode == 0, done.stderr
    assert "ran without sqlite3" in done.stdout
    assert done.stderr.count("LLM usage is not recorded") == 1  # said once, not per call
    assert "Traceback" not in done.stderr
