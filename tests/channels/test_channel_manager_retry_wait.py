"""Tests for ChannelManager routing of provider retry-wait notices.

A provider backoff produces no stream traffic, so from outside the agent loop
it is indistinguishable from a wedged turn — channels with a liveness surface
(typing indicator, status line, watchdog) were left guessing because the
manager dropped every ``RetryWaitEvent`` before dispatch. Notices now ride the
progress opt-in and reach ``BaseChannel.send_retry_wait``, whose default is a
no-op so channels without a place to put them are unaffected.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from nanobot.bus.outbound_events import RetryWaitEvent, outbound_message_for_event
from nanobot.bus.queue import MessageBus
from nanobot.channels.base import BaseChannel
from nanobot.channels.manager import ChannelManager
from nanobot.config.schema import Config


class _MockChannel(BaseChannel):
    name = "mock"
    display_name = "Mock"

    def __init__(self, config, bus):
        super().__init__(config, bus)
        self._send_mock = AsyncMock()
        self._retry_wait_mock = AsyncMock()

    async def start(self):  # pragma: no cover - not exercised
        pass

    async def stop(self):  # pragma: no cover - not exercised
        pass

    async def send(self, msg):
        return await self._send_mock(msg)

    async def send_retry_wait(self, chat_id, content, metadata=None):
        return await self._retry_wait_mock(chat_id, content, metadata)


@pytest.fixture
def manager() -> ChannelManager:
    config = Config.model_validate({"channels": {"websocket": {"enabled": False}}})
    mgr = ChannelManager(config, MessageBus())
    mgr.channels["mock"] = _MockChannel({}, mgr.bus)
    return mgr


def _notice(chat_id: str = "c1") -> object:
    return outbound_message_for_event(
        channel="mock",
        chat_id=chat_id,
        event=RetryWaitEvent(content="Model request failed, retry in 30s (attempt 2)."),
        metadata={"_turn": "t1"},
    )


async def _pump(manager: ChannelManager) -> None:
    """Run the real dispatch loop until the queue drains."""
    task = asyncio.create_task(manager._dispatch_outbound())
    try:
        while not manager.bus.outbound.empty():
            await asyncio.sleep(0)
        await asyncio.sleep(0)
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


@pytest.mark.asyncio
async def test_retry_wait_routes_to_the_channel_primitive(manager):
    channel = manager.channels["mock"]
    msg = _notice()

    await manager._send_once(channel, msg)

    channel._retry_wait_mock.assert_awaited_once_with(
        "c1", "Model request failed, retry in 30s (attempt 2).", msg.metadata
    )
    # Never a chat message: the notice is a liveness signal, not an answer.
    channel._send_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_dispatch_delivers_retry_wait_by_default(manager):
    channel = manager.channels["mock"]
    await manager.bus.publish_outbound(_notice())

    await _pump(manager)

    channel._retry_wait_mock.assert_awaited_once()
    channel._send_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_dispatch_drops_retry_wait_when_progress_is_off(manager):
    channel = manager.channels["mock"]
    channel.send_progress = False
    await manager.bus.publish_outbound(_notice())

    await _pump(manager)

    channel._retry_wait_mock.assert_not_awaited()
    channel._send_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_dispatch_survives_retry_wait_for_unknown_channel(manager):
    await manager.bus.publish_outbound(
        outbound_message_for_event(
            channel="ghost",
            chat_id="c1",
            event=RetryWaitEvent(content="nobody home"),
        )
    )

    await _pump(manager)

    manager.channels["mock"]._retry_wait_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_base_channel_retry_wait_is_noop_safe():
    class _Plain(BaseChannel):
        name = "plain"
        display_name = "Plain"

        async def start(self):  # pragma: no cover
            pass

        async def stop(self):  # pragma: no cover
            pass

        async def send(self, msg):  # pragma: no cover
            raise AssertionError("retry-wait notices must not reach send()")

    channel = _Plain({}, MessageBus())
    assert await channel.send_retry_wait("c", "waiting") is None
