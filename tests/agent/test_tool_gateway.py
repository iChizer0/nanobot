"""AgentLoop's ToolGateway seam: a channel-driven tool call must run under the
same guards as a normal turn, and must not leak them afterwards."""

from __future__ import annotations

import dataclasses
import inspect
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from nanobot.agent.loop import AgentLoop
from nanobot.agent.tools.context import current_request_context
from nanobot.agent.tools.file_state import current_file_states
from nanobot.bus.queue import MessageBus
from nanobot.channels.base import BaseChannel, ToolGateway
from nanobot.security.workspace_access import (
    current_scope_allows_loopback,
    current_tool_workspace,
    current_workspace_scope,
)
from nanobot.session.keys import UNIFIED_SESSION_KEY


def _make_loop(tmp_path: Path, *, unified_session: bool = False) -> AgentLoop:
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    provider.generation.max_tokens = 4096
    return AgentLoop(
        bus=MessageBus(),
        provider=provider,
        workspace=tmp_path,
        model="test-model",
        context_window_tokens=128_000,
        unified_session=unified_session,
    )


@pytest.mark.asyncio
async def test_execute_tool_binds_turn_guards(tmp_path) -> None:
    """The guards tools read are bound during execution and reset after."""
    loop = _make_loop(tmp_path)
    seen: dict = {}
    sentinel = object()

    async def fake_execute(name, args):
        seen["name"] = name
        seen["args"] = args
        seen["scope"] = current_workspace_scope()
        seen["workspace"] = current_tool_workspace(None).project_path
        seen["ctx"] = current_request_context()
        seen["file_states"] = current_file_states(sentinel)
        # SSRF loopback is gated on the WebUI websocket channel; anything else
        # must stay denied even with the feature enabled.
        seen["loopback"] = current_scope_allows_loopback(enabled=True)
        return "ok"

    loop.tools.execute = fake_execute

    result = await loop.execute_tool(
        "read_file", {"path": "x"}, channel="voice", chat_id="local",
    )

    assert result == "ok"
    assert (seen["name"], seen["args"]) == ("read_file", {"path": "x"})
    # Workspace scope is bound, and resolves to this loop's workspace.
    assert seen["scope"] is not None
    assert seen["workspace"] == tmp_path
    # Request context carries the calling channel + session identity + workspace.
    assert seen["ctx"].channel == "voice"
    assert seen["ctx"].chat_id == "local"
    assert seen["ctx"].session_key == "voice:local"
    assert seen["ctx"].workspace == tmp_path
    # File-state bookkeeping is this session's bucket, not another's.
    assert seen["file_states"] is loop._file_state_store.for_session("voice:local")
    # A non-websocket channel gets no loopback allowance.
    assert seen["loopback"] is False
    # Nothing leaks into the ambient context.
    assert current_workspace_scope() is None
    assert current_request_context() is None
    assert current_file_states(sentinel) is sentinel


@pytest.mark.asyncio
async def test_execute_tool_resets_guards_when_tool_raises(tmp_path) -> None:
    loop = _make_loop(tmp_path)
    sentinel = object()

    async def boom(name, args):
        assert current_workspace_scope() is not None
        raise RuntimeError("tool blew up")

    loop.tools.execute = boom

    with pytest.raises(RuntimeError, match="tool blew up"):
        await loop.execute_tool("x", {}, channel="voice", chat_id="local")

    assert current_workspace_scope() is None
    assert current_request_context() is None
    assert current_file_states(sentinel) is sentinel


@pytest.mark.asyncio
async def test_execute_tool_supplies_runtime(tmp_path) -> None:
    """Tools like spawn refuse to run without a runtime on the request context."""
    loop = _make_loop(tmp_path)
    seen: dict = {}

    async def fake_execute(name, args):
        seen["runtime"] = current_request_context().runtime
        return "ok"

    loop.tools.execute = fake_execute
    await loop.execute_tool("spawn", {}, channel="voice", chat_id="local")

    assert seen["runtime"] is not None
    assert seen["runtime"].model == "test-model"


@pytest.mark.asyncio
async def test_execute_tool_derives_the_same_session_key_as_the_bus(tmp_path) -> None:
    """The key must match the bus path, or file-state/session guards diverge."""
    loop = _make_loop(tmp_path)
    seen: dict = {}

    async def fake_execute(name, args):
        seen["key"] = current_request_context().session_key
        return "ok"

    loop.tools.execute = fake_execute
    await loop.execute_tool("x", {}, channel="voice", chat_id="local")
    assert seen["key"] == "voice:local"


@pytest.mark.asyncio
async def test_execute_tool_honors_unified_session(tmp_path) -> None:
    """With unified_session the bus collapses every key; the seam must too."""
    loop = _make_loop(tmp_path, unified_session=True)
    seen: dict = {}

    async def fake_execute(name, args):
        seen["key"] = current_request_context().session_key
        return "ok"

    loop.tools.execute = fake_execute
    await loop.execute_tool("x", {}, channel="voice", chat_id="local")
    assert seen["key"] == UNIFIED_SESSION_KEY


@pytest.mark.asyncio
async def test_execute_tool_honors_session_workspace_scope(tmp_path) -> None:
    """A scoped channel's stored workspace metadata must reach the tool."""
    project = tmp_path / "project"
    project.mkdir()
    loop = _make_loop(tmp_path)
    scoped = loop.workspace_scopes.scoped_channel
    session = loop.sessions.get_or_create(f"{scoped}:c1")
    session.metadata["workspace_scope"] = {
        "project_path": str(project),
        "access_mode": "full",
        "restrict_to_workspace": False,
        "source_channel": scoped,
    }
    seen: dict = {}

    async def fake_execute(name, args):
        seen["workspace"] = current_tool_workspace(None).project_path
        return "ok"

    loop.tools.execute = fake_execute
    await loop.execute_tool("x", {}, channel=scoped, chat_id="c1")

    # Resolved from the session's stored scope, not the loop-wide default.
    assert seen["workspace"] == project


@pytest.mark.asyncio
async def test_get_tool_definitions_does_not_alias_the_registry_cache(tmp_path) -> None:
    """Callers adapt schemas for their model; that must not reach the agent."""
    loop = _make_loop(tmp_path)
    defs = await loop.get_tool_definitions()
    assert defs == [d for d in loop.tools.get_definitions() if d in defs]

    before = len(loop.tools.get_definitions())
    defs.append({"type": "function", "function": {"name": "injected"}})
    defs[0]["function"]["description"] = "mutated"

    after = loop.tools.get_definitions()
    assert len(after) == before
    assert all(d["function"]["name"] != "injected" for d in after)
    assert after[0]["function"]["description"] != "mutated"


@pytest.mark.asyncio
async def test_get_tool_definitions_leaves_out_what_only_a_turn_can_run(tmp_path) -> None:
    """create_goal needs a turn's permission, which execute_tool never grants: offered, it
    only refuses. update_goal stays: completing or cancelling a goal needs none."""
    loop = _make_loop(tmp_path)
    registered = {d["function"]["name"] for d in loop.tools.get_definitions()}
    assert {"create_goal", "update_goal", "read_file"} <= registered

    offered = {d["function"]["name"] for d in await loop.get_tool_definitions()}

    assert offered == registered - {"create_goal"}
    refused = await loop.execute_tool(
        "create_goal", {"objective": "plan a trip"}, channel="voice", chat_id="local",
    )
    assert getattr(refused, "is_error", False)


@pytest.mark.asyncio
async def test_get_agent_context_carries_profile_memory_and_skills(tmp_path) -> None:
    loop = _make_loop(tmp_path)
    (tmp_path / "USER.md").write_text("The user is Ada; she likes short answers.\n")
    loop.context.memory.memory_file.parent.mkdir(parents=True, exist_ok=True)
    loop.context.memory.memory_file.write_text("Ada's cat is called Turing.\n")

    text = await loop.get_agent_context(channel="voice", chat_id="local")

    assert f"Working directory: {tmp_path.resolve()}" in text
    # Where the agent keeps its files, and that only memory consolidation edits them.
    assert "- Long-term memory: memory/MEMORY.md" in text
    assert "Only Dream memory-consolidation tasks may edit" in text
    assert "The user is Ada" in text
    assert "Ada's cat is called Turing." in text
    # The skills index, each skill at the path read_file takes: nothing left to join.
    assert "`skills/weather/SKILL.md`" in text
    assert "join them" not in text
    # Not the system prompt: no identity or tool contract.
    assert text != loop.context.build_system_prompt(channel="voice")
    assert len(text) < len(loop.context.build_system_prompt(channel="voice"))


@pytest.mark.asyncio
async def test_get_agent_context_without_tools_leaves_files_and_skills_out(tmp_path) -> None:
    """A model that only talks (the voice channel's supervisor) cannot follow a skill or
    grep the history log: both would send it down paths it has no tools for."""
    loop = _make_loop(tmp_path)
    (tmp_path / "USER.md").write_text("The user is Ada.\n")
    text = await loop.get_agent_context(channel="voice", chat_id="local", with_tools=False)
    assert f"Working directory: {tmp_path.resolve()}" in text
    assert "The user is Ada." in text
    assert "# Skills" not in text and "SKILL.md" not in text
    assert "history.jsonl" not in text and "Only Dream" not in text


@pytest.mark.asyncio
async def test_get_agent_context_leaves_memory_out_of_a_session_that_keeps_none(tmp_path) -> None:
    loop = _make_loop(tmp_path)
    loop.context.memory.memory_file.parent.mkdir(parents=True, exist_ok=True)
    loop.context.memory.memory_file.write_text("Ada's cat is called Turing.\n")
    session = loop.sessions.get_or_create("voice:local")
    session.policy = dataclasses.replace(session.policy, persist=False)

    text = await loop.get_agent_context(channel="voice", chat_id="local")

    assert "Turing" not in text


def test_agent_loop_matches_the_tool_gateway_signatures(tmp_path) -> None:
    """runtime_checkable only checks names, so pin the call shape explicitly."""
    loop = _make_loop(tmp_path)
    assert isinstance(loop, ToolGateway)
    for name in ("get_tool_definitions", "execute_tool", "get_agent_context"):
        impl = inspect.signature(getattr(loop, name))
        proto = inspect.signature(getattr(ToolGateway, name))
        # Compare names/kinds/defaults, not annotation spelling.
        expected = [
            (p.name, p.kind, p.default)
            for p in proto.parameters.values()
            if p.name != "self"
        ]
        actual = [(p.name, p.kind, p.default) for p in impl.parameters.values()]
        assert actual == expected, f"{name} drifted from ToolGateway"
        assert inspect.iscoroutinefunction(getattr(loop, name))


def test_channels_do_not_get_the_gateway_by_default() -> None:
    assert BaseChannel.wants_tool_gateway is False
