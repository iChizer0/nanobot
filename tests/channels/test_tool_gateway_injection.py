"""ChannelManager hands the tool gateway only to channels that opt in."""

from __future__ import annotations

from unittest.mock import MagicMock

from nanobot.bus.queue import MessageBus
from nanobot.channels.base import BaseChannel
from nanobot.channels.manager import ChannelManager
from nanobot.config.schema import Config


class _OptedIn(BaseChannel):
    name = "optedin"
    display_name = "OptedIn"
    wants_tool_gateway = True

    def __init__(self, config, bus, *, tool_gateway=None):
        super().__init__(config, bus)
        self.tool_gateway = tool_gateway

    async def start(self) -> None: ...
    async def stop(self) -> None: ...
    async def send(self, msg) -> None: ...


class _PlainChannel(BaseChannel):
    name = "plain"
    display_name = "Plain"

    def __init__(self, config, bus):
        super().__init__(config, bus)

    async def start(self) -> None: ...
    async def stop(self) -> None: ...
    async def send(self, msg) -> None: ...


def _manager(tool_gateway=None) -> ChannelManager:
    mgr = ChannelManager.__new__(ChannelManager)
    mgr.config = MagicMock()
    mgr.bus = MessageBus()
    mgr._tool_gateway = tool_gateway
    return mgr


def test_constructor_stores_the_tool_gateway() -> None:
    """Covers the gateway runtime -> __init__ -> _build_channel wiring."""
    sentinel = object()
    mgr = ChannelManager(Config(), MessageBus(), tool_gateway=sentinel)
    assert mgr._tool_gateway is sentinel


def test_opted_in_channel_receives_the_gateway() -> None:
    sentinel = object()
    channel = _manager(sentinel)._build_channel("optedin", _OptedIn, {})
    assert channel.tool_gateway is sentinel


def test_opted_in_channel_still_builds_without_a_wired_loop() -> None:
    """The kwarg is passed (as None) rather than silently omitted."""
    channel = _manager()._build_channel("optedin", _OptedIn, {})
    assert channel.tool_gateway is None


def test_plain_channel_is_untouched() -> None:
    channel = _manager(object())._build_channel("plain", _PlainChannel, {})
    assert not hasattr(channel, "tool_gateway")
