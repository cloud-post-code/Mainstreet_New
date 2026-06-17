"""Tests for session processing-lock staleness detection in agent/runner.py.

The core invariant: start_turn_run should raise 429 only when a live asyncio
task is actually running for the session.  If session.processing is True but
no task exists in _active_tasks, the lock is stale and the new turn must be
allowed to proceed.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Patch env before importing the module under test.
import os
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("FRONTEND_URL", "http://localhost:5173")


from agent import runner  # noqa: E402  (must be after env setup)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_session(*, processing: bool, session_id: int = 1) -> MagicMock:
    s = MagicMock()
    s.id = session_id
    s.processing = processing
    return s


def _make_run(run_id: int, session_id: int = 1) -> MagicMock:
    r = MagicMock()
    r.id = run_id
    r.session_id = session_id
    return r


# ---------------------------------------------------------------------------
# _session_has_live_task
# ---------------------------------------------------------------------------

def _mock_db_with_run_ids(run_ids: list[int]) -> AsyncMock:
    """Build an AsyncMock db whose execute(...).scalars().all() returns run_ids."""
    scalars_result = MagicMock()
    scalars_result.all.return_value = run_ids

    execute_result = MagicMock()
    execute_result.scalars.return_value = scalars_result

    db = AsyncMock()
    db.execute.return_value = execute_result
    return db


@pytest.mark.asyncio
async def test_no_live_task_returns_false_when_active_tasks_empty():
    """No entry in _active_tasks → not live."""
    db = _mock_db_with_run_ids([42])
    runner._active_tasks.clear()

    result = await runner._session_has_live_task(db, session_id=1)
    assert result is False


@pytest.mark.asyncio
async def test_live_task_returns_true_when_run_in_active_tasks():
    """run_id present in _active_tasks → live."""
    db = _mock_db_with_run_ids([99])

    fake_task = MagicMock(spec=asyncio.Task)
    runner._active_tasks[99] = fake_task

    try:
        result = await runner._session_has_live_task(db, session_id=1)
        assert result is True
    finally:
        runner._active_tasks.pop(99, None)


@pytest.mark.asyncio
async def test_returns_false_when_db_returns_no_running_rows():
    """No running AgentTurnRun rows → definitely not live."""
    db = _mock_db_with_run_ids([])
    runner._active_tasks.clear()

    result = await runner._session_has_live_task(db, session_id=1)
    assert result is False


# ---------------------------------------------------------------------------
# start_turn_run — stale lock behaviour
# ---------------------------------------------------------------------------

def _patch_start_turn_run_deps(
    *,
    has_live_task: bool,
    active_run_count: int = 0,
):
    """Return a context-manager stack that patches all I/O in start_turn_run."""
    import contextlib

    @contextlib.asynccontextmanager
    async def _stack():
        with (
            patch.object(runner, "_session_has_live_task", new=AsyncMock(return_value=has_live_task)),
            patch.object(runner, "_count_user_active_runs", new=AsyncMock(return_value=active_run_count)),
            patch.object(runner, "_run_turn_background", new=AsyncMock()),
            patch("asyncio.create_task", return_value=MagicMock(add_done_callback=lambda _: None)),
        ):
            yield

    return _stack()


@pytest.mark.asyncio
async def test_stale_lock_is_cleared_and_turn_proceeds():
    """processing=True but no live task → lock is stale, new turn allowed."""
    session = _make_session(processing=True, session_id=1)

    db = AsyncMock()
    run_mock = MagicMock()
    run_mock.id = 7
    db.refresh = AsyncMock()

    # Simulate db.add + db.execute + db.commit doing nothing meaningful,
    # and db.refresh populating run.id.
    async def _fake_refresh(obj):
        obj.id = 7
    db.refresh.side_effect = _fake_refresh

    added_objects = []
    db.add.side_effect = added_objects.append

    async with _patch_start_turn_run_deps(has_live_task=False):
        result = await runner.start_turn_run(
            db,
            session=session,
            user_id=None,
            message="hello",
            question_card_id=None,
            mode_override=None,
        )

    # Should have returned a run (not raised).
    assert result is not None


@pytest.mark.asyncio
async def test_live_lock_raises_429():
    """processing=True with a live task → 429."""
    from fastapi import HTTPException

    session = _make_session(processing=True, session_id=1)
    db = AsyncMock()

    async with _patch_start_turn_run_deps(has_live_task=True):
        with pytest.raises(HTTPException) as exc_info:
            await runner.start_turn_run(
                db,
                session=session,
                user_id=None,
                message="hello",
                question_card_id=None,
                mode_override=None,
            )

    assert exc_info.value.status_code == 429
    assert "already in progress" in exc_info.value.detail


@pytest.mark.asyncio
async def test_processing_false_proceeds_normally():
    """processing=False (normal case) → no 429, turn starts."""
    session = _make_session(processing=False, session_id=1)
    db = AsyncMock()

    async def _fake_refresh(obj):
        obj.id = 5
    db.refresh.side_effect = _fake_refresh

    async with _patch_start_turn_run_deps(has_live_task=False, active_run_count=0):
        result = await runner.start_turn_run(
            db,
            session=session,
            user_id=None,
            message="hello",
            question_card_id=None,
            mode_override=None,
        )

    assert result is not None


@pytest.mark.asyncio
async def test_max_background_runs_raises_429():
    """Even if no live task for this session, hitting the per-user cap → 429."""
    from fastapi import HTTPException

    session = _make_session(processing=False, session_id=1)
    db = AsyncMock()

    async with _patch_start_turn_run_deps(has_live_task=False, active_run_count=3):
        with pytest.raises(HTTPException) as exc_info:
            await runner.start_turn_run(
                db,
                session=session,
                user_id=42,
                message="hello",
                question_card_id=None,
                mode_override=None,
            )

    assert exc_info.value.status_code == 429
    assert exc_info.value.detail == "max_background_turns"
