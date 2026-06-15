"""Tests for Boards feature input/validation logic.

Covers:
  - Board CRUD memory functions (create_board, list_boards, get_board, update_board, delete_board)
  - Board product operations (save_product_to_board, remove_product_from_board)
  - Board notes operations (add_note_to_board, delete_board_note)
  - Migration logic (get_or_create_default_board)
  - REST API Pydantic schema validation
  - Tool execution routing for all five new board tools + save_product backward compat

No real Postgres needed — all DB calls are mocked with AsyncMock/MagicMock.
"""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

# ── helpers ──────────────────────────────────────────────────────────────────

def _run(coro):
    return asyncio.run(coro)


def _fake_db_first(value):
    """DB whose execute().scalars().first() returns `value`."""
    db = MagicMock()
    result = MagicMock()
    result.scalars.return_value.first.return_value = value
    db.execute = AsyncMock(return_value=result)
    db.add = MagicMock()
    db.delete = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _fake_db_scalar(value):
    """DB whose execute().scalar() returns `value`."""
    db = MagicMock()
    result = MagicMock()
    result.scalar.return_value = value
    db.execute = AsyncMock(return_value=result)
    db.add = MagicMock()
    db.delete = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _fake_db_all(rows):
    """DB whose execute().scalars().all() returns `rows`."""
    db = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    db.execute = AsyncMock(return_value=result)
    db.add = MagicMock()
    db.delete = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _board(**kw):
    defaults = dict(
        id=1, user_id=10, name="My Home", description="Home stuff",
        cover_image_url=None, is_default=False,
        created_at=None, updated_at=None,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _board_note(**kw):
    defaults = dict(id=1, board_id=1, text="Looking for a rug", created_at=None)
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _board_product(**kw):
    defaults = dict(id=1, board_id=1, product_id=42, saved_at=None)
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _saved_product(**kw):
    defaults = dict(id=1, user_id=10, product_id=42, created_at=None)
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _memory_note(**kw):
    defaults = dict(id=1, user_id=10, key="note:abc", value={"text": "Likes earthy tones"}, created_at=None)
    defaults.update(kw)
    return SimpleNamespace(**defaults)


# ─────────────────────────────────────────────────────────────────────────────
# Group 1: create_board() validation
# ─────────────────────────────────────────────────────────────────────────────

class TestCreateBoardValidation:
    """
    create_board() in agent/memory.py validates name before any DB write.
    These tests confirm each guard fires at the right moment.
    """

    def test_rejects_empty_name(self):
        """
        An empty string collapses to "" after .strip(), triggering
        ValueError("board name required") before any DB call.
        Guards against Mason passing create_board(name="") on a bad extraction.
        """
        from agent.memory import create_board
        db = MagicMock()
        with pytest.raises(ValueError, match="board name required"):
            _run(create_board(user_id=10, name="", description=None, db=db))
        db.add.assert_not_called()

    def test_rejects_whitespace_only_name(self):
        """
        Whitespace-only string ("   ") strips to "", hitting the same early exit.
        Confirms .strip() runs before the empty check, not after.
        """
        from agent.memory import create_board
        db = MagicMock()
        with pytest.raises(ValueError, match="board name required"):
            _run(create_board(user_id=10, name="   ", description=None, db=db))

    def test_rejects_when_cap_reached(self):
        """
        The function queries COUNT(Board.id) first. When count >= MAX_BOARDS (50),
        raises ValueError before any INSERT. Prevents runaway board creation by Mason.

        DB mock returns scalar=50, so the cap branch fires immediately.
        """
        from agent.memory import create_board, MAX_BOARDS
        # First execute: count query returns 50
        db = MagicMock()
        count_result = MagicMock()
        count_result.scalar.return_value = MAX_BOARDS
        db.execute = AsyncMock(return_value=count_result)
        db.add = MagicMock()

        with pytest.raises(ValueError, match="board limit reached"):
            _run(create_board(user_id=10, name="New Board", description=None, db=db))
        db.add.assert_not_called()

    def test_deduplicates_case_insensitively(self):
        """
        If board "my home" exists, create_board(name="My Home") should return
        the existing board without inserting. The SQL uses func.lower() for
        case-insensitive match. db.add must NOT be called.

        This prevents Mason from creating the same board twice across conversations.
        """
        from agent.memory import create_board
        existing = _board(id=3, name="my home")
        db = MagicMock()

        # Execute calls:
        # 1st: count query
        # 2nd: existing name lookup → returns the existing board
        count_result = MagicMock()
        count_result.scalar.return_value = 1

        name_result = MagicMock()
        name_result.scalars.return_value.first.return_value = existing

        db.execute = AsyncMock(side_effect=[count_result, name_result])
        db.add = MagicMock()
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        result = _run(create_board(user_id=10, name="My Home", description=None, db=db))
        db.add.assert_not_called()
        assert result["id"] == 3

    def test_succeeds_with_valid_name(self):
        """
        Happy path: count below cap, no duplicate, board inserted.
        db.add is called with a Board object, flush is called, and
        the returned dict has note_count=0 and product_count=0.
        """
        from agent.memory import create_board

        count_result = MagicMock()
        count_result.scalar.return_value = 2

        name_result = MagicMock()
        name_result.scalars.return_value.first.return_value = None  # no duplicate

        db = MagicMock()
        db.execute = AsyncMock(side_effect=[count_result, name_result])
        db.add = MagicMock()
        db.flush = AsyncMock()

        # db.refresh populates the board object with an id after flush
        async def fake_refresh(obj):
            obj.id = 99
            obj.created_at = None
            obj.updated_at = None

        db.refresh = fake_refresh

        result = _run(create_board(user_id=10, name="Future Life", description="Dreams", db=db))

        db.add.assert_called_once()
        assert result["note_count"] == 0
        assert result["product_count"] == 0
        assert result["name"] == "Future Life"

    def test_truncates_name_at_200_chars(self):
        """
        A 300-char name is accepted but stored truncated to 200 chars.
        The function does name[:200] before any DB interaction.
        Prevents column overflow without raising an error.

        We check the Board object passed to db.add has a name of <= 200 chars.
        """
        from agent.memory import create_board
        from db.models import Board as BoardModel

        long_name = "A" * 300

        count_result = MagicMock()
        count_result.scalar.return_value = 0

        name_result = MagicMock()
        name_result.scalars.return_value.first.return_value = None

        db = MagicMock()
        db.execute = AsyncMock(side_effect=[count_result, name_result])
        db.add = MagicMock()
        db.flush = AsyncMock()

        async def fake_refresh(obj):
            obj.id = 1
            obj.created_at = None
            obj.updated_at = None

        db.refresh = fake_refresh

        _run(create_board(user_id=10, name=long_name, description=None, db=db))

        # The Board instance passed to db.add should have truncated name
        added_board = db.add.call_args[0][0]
        assert len(added_board.name) <= 200


# ─────────────────────────────────────────────────────────────────────────────
# Group 2: add_note_to_board() validation
# ─────────────────────────────────────────────────────────────────────────────

class TestAddNoteToBoardValidation:
    """
    add_note_to_board() validates board ownership, empty text, and deduplication.
    Mason calls this to attach contextual notes to a specific board.
    """

    def test_rejects_nonexistent_board(self):
        """
        Board lookup by (board_id, user_id) returns None → ValueError raised.
        Prevents writing notes to a board the user deleted or doesn't own.
        db.add must not be called.
        """
        from agent.memory import add_note_to_board
        db = _fake_db_first(None)  # board not found

        with pytest.raises(ValueError, match="not found"):
            _run(add_note_to_board(user_id=10, board_id=99, text="test note", db=db))
        db.add.assert_not_called()

    def test_rejects_empty_text(self):
        """
        After board is found, text="" triggers ValueError("empty note").
        This is the first line of defense before any BoardNote insert.
        Guards against Mason calling save_note_to_board with an empty extraction.
        """
        from agent.memory import add_note_to_board
        board = _board(id=1)
        db = _fake_db_first(board)

        with pytest.raises(ValueError, match="empty note"):
            _run(add_note_to_board(user_id=10, board_id=1, text="", db=db))
        db.add.assert_not_called()

    def test_rejects_whitespace_only_text(self):
        """
        Whitespace-only text strips to "" → same empty-note guard fires.
        """
        from agent.memory import add_note_to_board
        board = _board(id=1)
        db = _fake_db_first(board)

        with pytest.raises(ValueError, match="empty note"):
            _run(add_note_to_board(user_id=10, board_id=1, text="   ", db=db))

    def test_deduplicates_case_insensitively(self):
        """
        If a note with the same lowercased/trimmed text already exists,
        the function returns the existing note without inserting a duplicate.
        db.add must NOT be called.

        Mason often re-saves the same contextual fact across turns.
        Silent dedup prevents the same note appearing ten times.
        """
        from agent.memory import add_note_to_board
        board = _board(id=1)
        existing_note = _board_note(id=7, text="Buy a rug", board_id=1)

        db = MagicMock()
        board_result = MagicMock()
        board_result.scalars.return_value.first.return_value = board

        dup_result = MagicMock()
        dup_result.scalars.return_value.first.return_value = existing_note

        db.execute = AsyncMock(side_effect=[board_result, dup_result])
        db.add = MagicMock()
        db.flush = AsyncMock()

        result = _run(add_note_to_board(user_id=10, board_id=1, text="buy a rug", db=db))
        db.add.assert_not_called()
        assert result["id"] == 7

    def test_succeeds_and_returns_note_dict(self):
        """
        Happy path: board found, no duplicate, note inserted.
        Returns dict with id, board_id, text, created_at.
        db.add is called once with the new BoardNote object.
        """
        from agent.memory import add_note_to_board

        board = _board(id=1)

        db = MagicMock()
        board_result = MagicMock()
        board_result.scalars.return_value.first.return_value = board

        dup_result = MagicMock()
        dup_result.scalars.return_value.first.return_value = None  # no duplicate

        db.execute = AsyncMock(side_effect=[board_result, dup_result])
        db.add = MagicMock()
        db.flush = AsyncMock()

        async def fake_refresh(obj):
            obj.id = 9
            obj.created_at = None

        db.refresh = fake_refresh

        result = _run(add_note_to_board(user_id=10, board_id=1, text="Wants earthy tones", db=db))

        db.add.assert_called_once()
        assert result["board_id"] == 1
        assert result["text"] == "Wants earthy tones"


# ─────────────────────────────────────────────────────────────────────────────
# Group 3: save_product_to_board() and remove_product_from_board()
# ─────────────────────────────────────────────────────────────────────────────

class TestBoardProductOperations:
    """
    save_product_to_board validates board ownership and product existence.
    remove_product_from_board validates board ownership before deleting.
    """

    def test_save_rejects_nonexistent_board(self):
        """
        Board lookup (board_id, user_id) returns None → ValueError.
        User can't save products to a board they don't own or that was deleted.
        """
        from agent.memory import save_product_to_board
        db = _fake_db_first(None)
        with pytest.raises(ValueError, match="not found"):
            _run(save_product_to_board(user_id=10, board_id=99, product_id=42, db=db))
        db.add.assert_not_called()

    def test_save_rejects_nonexistent_product(self):
        """
        Board found but product lookup returns None → ValueError("product {id} not found").
        Prevents a dangling FK insert when the product was just deleted by admin.

        DB mock: first execute = board found, second execute = product not found.
        """
        from agent.memory import save_product_to_board
        board = _board(id=1)
        db = MagicMock()
        board_result = MagicMock()
        board_result.scalars.return_value.first.return_value = board
        product_result = MagicMock()
        product_result.scalars.return_value.first.return_value = None

        db.execute = AsyncMock(side_effect=[board_result, product_result])
        db.add = MagicMock()

        with pytest.raises(ValueError, match="not found"):
            _run(save_product_to_board(user_id=10, board_id=1, product_id=999, db=db))
        db.add.assert_not_called()

    def test_save_is_idempotent_returns_false(self):
        """
        If BoardProduct(board_id, product_id) already exists, returns False
        (not newly saved) without inserting again. "Idempotent" means calling
        it twice produces the same state. Mason saving the same product twice
        in a conversation should not create a duplicate row.
        """
        from agent.memory import save_product_to_board
        board = _board(id=1)
        product = SimpleNamespace(id=42)
        existing_bp = _board_product(board_id=1, product_id=42)

        db = MagicMock()
        results = [
            MagicMock(), MagicMock(), MagicMock()
        ]
        results[0].scalars.return_value.first.return_value = board
        results[1].scalars.return_value.first.return_value = product
        results[2].scalars.return_value.first.return_value = existing_bp

        db.execute = AsyncMock(side_effect=results)
        db.add = MagicMock()

        result = _run(save_product_to_board(user_id=10, board_id=1, product_id=42, db=db))
        db.add.assert_not_called()
        assert result is False

    def test_save_returns_true_when_newly_saved(self):
        """
        Happy path: board found, product found, no existing BoardProduct → insert, return True.
        """
        from agent.memory import save_product_to_board
        board = _board(id=1)
        product = SimpleNamespace(id=42)

        db = MagicMock()
        results = [MagicMock(), MagicMock(), MagicMock()]
        results[0].scalars.return_value.first.return_value = board
        results[1].scalars.return_value.first.return_value = product
        results[2].scalars.return_value.first.return_value = None  # not already saved

        db.execute = AsyncMock(side_effect=results)
        db.add = MagicMock()
        db.flush = AsyncMock()

        result = _run(save_product_to_board(user_id=10, board_id=1, product_id=42, db=db))
        db.add.assert_called_once()
        assert result is True

    def test_remove_returns_false_for_wrong_user(self):
        """
        remove_product_from_board checks board ownership first.
        If board lookup (board_id, user_id) returns None → return False.
        Prevents user A removing products from user B's board by guessing board_id.
        db.delete must not be called.
        """
        from agent.memory import remove_product_from_board
        db = _fake_db_first(None)  # board not found for this user
        result = _run(remove_product_from_board(user_id=10, board_id=99, product_id=42, db=db))
        assert result is False
        db.delete.assert_not_called()

    def test_remove_returns_false_when_product_not_in_board(self):
        """
        Board exists for user, but no BoardProduct row for that product_id.
        Returns False without deleting anything.
        """
        from agent.memory import remove_product_from_board
        board = _board(id=1)
        db = MagicMock()
        board_result = MagicMock()
        board_result.scalars.return_value.first.return_value = board
        bp_result = MagicMock()
        bp_result.scalars.return_value.first.return_value = None

        db.execute = AsyncMock(side_effect=[board_result, bp_result])
        db.delete = MagicMock()

        result = _run(remove_product_from_board(user_id=10, board_id=1, product_id=42, db=db))
        assert result is False
        db.delete.assert_not_called()

    def test_remove_deletes_and_returns_true(self):
        """
        Happy path: board found, BoardProduct found → db.delete called → True returned.
        db.delete is AsyncMock because memory.py does `await db.delete(row)`.
        """
        from agent.memory import remove_product_from_board
        board = _board(id=1)
        bp = _board_product(board_id=1, product_id=42)

        db = MagicMock()
        board_result = MagicMock()
        board_result.scalars.return_value.first.return_value = board
        bp_result = MagicMock()
        bp_result.scalars.return_value.first.return_value = bp

        db.execute = AsyncMock(side_effect=[board_result, bp_result])
        db.delete = AsyncMock()
        db.flush = AsyncMock()

        result = _run(remove_product_from_board(user_id=10, board_id=1, product_id=42, db=db))
        assert result is True
        db.delete.assert_called_once_with(bp)


# ─────────────────────────────────────────────────────────────────────────────
# Group 4: Board CRUD — list, get, update, delete
# ─────────────────────────────────────────────────────────────────────────────

class TestBoardCRUD:
    """
    list_boards, get_board, update_board, delete_board all enforce user ownership.
    Write ops return None/False (not raise) when board not found for that user.
    """

    def test_list_boards_returns_empty_for_new_user(self):
        """
        No Board rows for user_id → returns [].
        The frontend shows "No boards yet" state on first visit.
        """
        from agent.memory import list_boards
        db = _fake_db_all([])
        # COUNT queries also need to return something; mock all() for board list
        result = _run(list_boards(user_id=10, db=db))
        assert result == []

    def test_get_board_returns_none_for_wrong_user(self):
        """
        get_board(user_id=10, board_id=99) fetches Board where id=99 AND user_id=10.
        Returns None when not found — ownership guard prevents user B from reading
        user A's board detail by guessing a board_id.
        """
        from agent.memory import get_board
        db = _fake_db_first(None)
        result = _run(get_board(user_id=10, board_id=99, db=db))
        assert result is None

    def test_update_board_returns_none_for_wrong_user(self):
        """
        update_board fetches board by (id, user_id) first. Not found → returns None.
        Same ownership guard pattern as get_board. No DB write occurs.
        """
        from agent.memory import update_board
        db = _fake_db_first(None)
        result = _run(update_board(user_id=10, board_id=99, patch={"name": "X"}, db=db))
        assert result is None
        db.flush.assert_not_called()

    def test_update_board_applies_name_patch(self):
        """
        Board found, patch contains valid name → board.name is updated.
        The name is set on the in-memory object before flush.
        """
        from agent.memory import update_board
        board = _board(id=1, name="Old Name")

        db = MagicMock()
        board_result = MagicMock()
        board_result.scalars.return_value.first.return_value = board

        # After flush, COUNT queries run for note/product counts
        count_result = MagicMock()
        count_result.scalar.return_value = 0

        db.execute = AsyncMock(side_effect=[board_result, count_result, count_result])
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        _run(update_board(user_id=10, board_id=1, patch={"name": "New Name"}, db=db))
        assert board.name == "New Name"
        db.flush.assert_called()

    def test_update_board_ignores_empty_name_in_patch(self):
        """
        patch={"name": ""} → the guard `if "name" in patch and patch["name"]` is falsy,
        so name is NOT changed. Prevents the frontend accidentally wiping the board name
        with an unintended empty string in a PATCH request.
        """
        from agent.memory import update_board
        board = _board(id=1, name="Keep This Name")

        db = MagicMock()
        board_result = MagicMock()
        board_result.scalars.return_value.first.return_value = board
        count_result = MagicMock()
        count_result.scalar.return_value = 0
        db.execute = AsyncMock(side_effect=[board_result, count_result, count_result])
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        _run(update_board(user_id=10, board_id=1, patch={"name": ""}, db=db))
        assert board.name == "Keep This Name"

    def test_delete_board_returns_false_for_wrong_user(self):
        """
        Board not found for (id, user_id) → returns False, db.delete not called.
        User can't delete another user's board by guessing an id.
        """
        from agent.memory import delete_board
        db = _fake_db_first(None)
        result = _run(delete_board(user_id=10, board_id=99, db=db))
        assert result is False
        db.delete.assert_not_called()

    def test_delete_board_returns_true_and_deletes(self):
        """
        Happy path: board found → db.delete(board) called → returns True.
        FK cascade handles BoardProduct and BoardNote rows automatically.
        db.delete must be AsyncMock because memory.py does `await db.delete(board)`.
        """
        from agent.memory import delete_board
        board = _board(id=1)
        # _fake_db_first already sets db.delete = AsyncMock()
        db = _fake_db_first(board)
        result = _run(delete_board(user_id=10, board_id=1, db=db))
        assert result is True
        db.delete.assert_called_once_with(board)


# ─────────────────────────────────────────────────────────────────────────────
# Group 5: get_or_create_default_board() — migration logic
# ─────────────────────────────────────────────────────────────────────────────

class TestGetOrCreateDefaultBoard:
    """
    get_or_create_default_board() is the lazy migration trigger.
    On first call for a user with no boards, it creates a "Saved" board
    and migrates all existing SavedProduct and UserMemory note rows into it.
    On subsequent calls it returns the existing first board without inserting.
    """

    def test_returns_existing_board_without_creating(self):
        """
        If an is_default board exists, return it immediately — no db.add, no migration.
        """
        from agent.memory import get_or_create_default_board

        existing = _board(id=1, name="My Board", description="Your saved items", is_default=True, created_at=None, updated_at=None)

        # db.execute calls: is_default query, note_count, product_count
        default_result = MagicMock()
        default_result.scalars.return_value.first.return_value = existing
        note_count_result = MagicMock()
        note_count_result.scalar.return_value = 2
        product_count_result = MagicMock()
        product_count_result.scalar.return_value = 5

        db = MagicMock()
        db.execute = AsyncMock(side_effect=[default_result, note_count_result, product_count_result])
        db.add = MagicMock()

        result = _run(get_or_create_default_board(user_id=10, db=db))

        assert result["id"] == 1
        db.add.assert_not_called()

    def test_creates_default_board_when_none_exist(self):
        """
        No is_default board exists → creates Board(name="My Board", is_default=True).
        The board is added via db.add and flushed before migration runs.
        """
        from agent.memory import get_or_create_default_board

        db = MagicMock()

        # execute calls: is_default check (None), SavedProduct query, UserMemory notes query
        no_default_result = MagicMock()
        no_default_result.scalars.return_value.first.return_value = None
        saved_result = MagicMock()
        saved_result.scalars.return_value.all.return_value = []
        notes_result = MagicMock()
        notes_result.scalars.return_value.all.return_value = []

        db.execute = AsyncMock(side_effect=[no_default_result, saved_result, notes_result])
        db.add = MagicMock()
        db.flush = AsyncMock()

        # Use a real Board-like object so db.refresh can set its id
        added_board = None
        original_add = db.add.side_effect

        def capture_add(obj):
            nonlocal added_board
            if hasattr(obj, "name") and hasattr(obj, "is_default"):
                added_board = obj
                obj.id = 99

        db.add.side_effect = capture_add
        db.refresh = AsyncMock()

        result = _run(get_or_create_default_board(user_id=10, db=db))

        assert added_board is not None
        assert added_board.name == "My Board"
        assert added_board.is_default is True
        assert added_board.user_id == 10
        db.add.assert_called()

    def test_migrates_existing_saved_products(self):
        """
        When creating the default board, all SavedProduct rows for the user
        are migrated into BoardProduct rows — one db.add per SavedProduct.

        This is the critical migration path: existing users must see their
        saved products appear in the new "Saved" board on first access.
        If this breaks, existing users lose their saved items.
        """
        from agent.memory import get_or_create_default_board

        created_board = _board(id=99, name="Saved")
        sp1 = _saved_product(product_id=10)
        sp2 = _saved_product(product_id=20)

        db = MagicMock()

        no_default_result = MagicMock()
        no_default_result.scalars.return_value.first.return_value = None
        saved_result = MagicMock()
        saved_result.scalars.return_value.all.return_value = [sp1, sp2]
        notes_result = MagicMock()
        notes_result.scalars.return_value.all.return_value = []

        db.execute = AsyncMock(side_effect=[no_default_result, saved_result, notes_result])
        added_objects = []

        def capture_add(obj):
            if hasattr(obj, "name") and hasattr(obj, "is_default"):
                obj.id = 99
            added_objects.append(obj)

        db.add = MagicMock(side_effect=capture_add)
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        _run(get_or_create_default_board(user_id=10, db=db))

        # BoardProduct should be added once per saved product
        from db.models import BoardProduct
        board_products = [o for o in added_objects if isinstance(o, BoardProduct)]
        assert len(board_products) == 2
        assert db.add.call_count >= 3  # 1 Board + 2 BoardProducts

    def test_migrates_existing_notes(self):
        """
        Existing UserMemory note: rows (keys starting with "note:") are migrated
        into BoardNote rows on the default board.

        Users also have notes in the old user_memory table. This test verifies
        they carry over so notes don't disappear on first Boards page visit.
        """
        from agent.memory import get_or_create_default_board

        created_board = _board(id=99, name="Saved")
        note = _memory_note(value={"text": "Likes earthy tones"})

        db = MagicMock()

        no_default_result = MagicMock()
        no_default_result.scalars.return_value.first.return_value = None
        saved_result = MagicMock()
        saved_result.scalars.return_value.all.return_value = []
        notes_result = MagicMock()
        notes_result.scalars.return_value.all.return_value = [note]

        db.execute = AsyncMock(side_effect=[no_default_result, saved_result, notes_result])
        added_objects = []

        def capture_add(obj):
            if hasattr(obj, "name") and hasattr(obj, "is_default"):
                obj.id = 99
            added_objects.append(obj)

        db.add = MagicMock(side_effect=capture_add)
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        _run(get_or_create_default_board(user_id=10, db=db))

        from db.models import BoardNote
        board_notes = [o for o in added_objects if isinstance(o, BoardNote)]
        assert len(board_notes) == 1
        assert board_notes[0].text == "Likes earthy tones"

    def test_skips_empty_note_text_during_migration(self):
        """
        If a UserMemory row has a value where _note_text() returns "" — an empty string —
        no BoardNote is created. The migration guard is `if text:` which is falsy for "".

        _note_text("") → not a dict → str("") = "" → falsy → skipped.
        This covers a corrupted/cleared UserMemory row where the value was saved as "".
        Guards against blank BoardNote rows appearing after migration.
        """
        from agent.memory import get_or_create_default_board

        created_board = _board(id=99, name="Saved")
        # Empty string value — _note_text("") returns "" which is falsy → skipped
        bad_note = _memory_note(value="")

        db = MagicMock()

        no_default_result = MagicMock()
        no_default_result.scalars.return_value.first.return_value = None
        saved_result = MagicMock()
        saved_result.scalars.return_value.all.return_value = []
        notes_result = MagicMock()
        notes_result.scalars.return_value.all.return_value = [bad_note]

        db.execute = AsyncMock(side_effect=[no_default_result, saved_result, notes_result])
        added_objects = []

        def capture_add(obj):
            if hasattr(obj, "name") and hasattr(obj, "is_default"):
                obj.id = 99
            added_objects.append(obj)

        db.add = MagicMock(side_effect=capture_add)
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        _run(get_or_create_default_board(user_id=10, db=db))

        from db.models import BoardNote
        board_notes = [o for o in added_objects if isinstance(o, BoardNote)]
        assert len(board_notes) == 0


# ─────────────────────────────────────────────────────────────────────────────
# Group 6: REST API Pydantic schema validation
# ─────────────────────────────────────────────────────────────────────────────

class TestBoardAPISchemas:
    """
    The Pydantic models in routers/mason_memory.py are the API's first input gate.
    These tests confirm field constraints enforce before the memory layer is reached.
    No HTTP client or FastAPI test client needed — just Pydantic model instantiation.
    """

    def test_board_create_rejects_empty_name(self):
        """
        BoardCreate(name="") raises ValidationError because min_length=1 on name.
        This fires before create_board() is called — the FastAPI route returns 422.
        """
        from pydantic import ValidationError
        from routers.mason_memory import BoardCreate
        with pytest.raises(ValidationError):
            BoardCreate(name="")

    def test_board_create_rejects_name_over_200_chars(self):
        """
        BoardCreate(name="x"*201) raises ValidationError — max_length=200.
        The memory layer also truncates, but the schema is the first gate.
        """
        from pydantic import ValidationError
        from routers.mason_memory import BoardCreate
        with pytest.raises(ValidationError):
            BoardCreate(name="x" * 201)

    def test_board_create_accepts_valid_name(self):
        """
        BoardCreate(name="My Home") succeeds. description is optional, defaults to None.
        """
        from routers.mason_memory import BoardCreate
        body = BoardCreate(name="My Home")
        assert body.name == "My Home"
        assert body.description is None

    def test_board_create_accepts_description(self):
        """
        BoardCreate with both name and description set — both fields present in model.
        """
        from routers.mason_memory import BoardCreate
        body = BoardCreate(name="Mom Gift", description="Ideas for mom's birthday")
        assert body.description == "Ideas for mom's birthday"

    def test_board_create_rejects_description_over_1000_chars(self):
        """
        BoardCreate(description="x"*1001) raises ValidationError — max_length=1000 on description.
        Prevents a very long description from being stored in the DB text column.
        """
        from pydantic import ValidationError
        from routers.mason_memory import BoardCreate
        with pytest.raises(ValidationError):
            BoardCreate(name="OK", description="x" * 1001)

    def test_board_note_rejects_empty_text(self):
        """
        BoardNoteIn(text="") raises ValidationError — min_length=1.
        The API returns 422 before any DB write.
        """
        from pydantic import ValidationError
        from routers.mason_memory import BoardNoteIn
        with pytest.raises(ValidationError):
            BoardNoteIn(text="")

    def test_board_note_rejects_text_over_500_chars(self):
        """
        BoardNoteIn(text="x"*501) raises ValidationError — max_length=500.
        Matches MAX_BOARD_NOTE_CHARS in memory.py — schema and logic are aligned.
        """
        from pydantic import ValidationError
        from routers.mason_memory import BoardNoteIn
        with pytest.raises(ValidationError):
            BoardNoteIn(text="x" * 501)

    def test_board_note_accepts_valid_text(self):
        """
        BoardNoteIn(text="Looking for a wool rug") succeeds — normal note text.
        """
        from routers.mason_memory import BoardNoteIn
        body = BoardNoteIn(text="Looking for a wool rug")
        assert body.text == "Looking for a wool rug"

    def test_board_product_requires_product_id(self):
        """
        BoardProductIn() with no args raises ValidationError — product_id is required.
        Prevents a PATCH /boards/{id}/products with a missing body field.
        """
        from pydantic import ValidationError
        from routers.mason_memory import BoardProductIn
        with pytest.raises(ValidationError):
            BoardProductIn()

    def test_board_patch_allows_all_optional(self):
        """
        BoardPatch() with no args is valid — all fields are Optional.
        The PATCH endpoint supports partial updates; omitting a field leaves it unchanged.
        This confirms exclude_unset=True in the route handler will produce an empty dict.
        """
        from routers.mason_memory import BoardPatch
        body = BoardPatch()
        assert body.name is None
        assert body.description is None


# ─────────────────────────────────────────────────────────────────────────────
# Group 7: Tool execution — new board tools via execute_tool()
# ─────────────────────────────────────────────────────────────────────────────

class TestToolExecution:
    """
    execute_tool() in agent/tools.py routes tool names to memory functions.
    These tests verify: login guards, error propagation, return value shapes,
    and that the routing calls the right memory function with the right args.
    """

    # ── list_boards ──────────────────────────────────────────────────────────

    def test_list_boards_requires_login(self):
        """
        user_id=None → returns ({"boards": [], "reason": "not_logged_in"}, None).
        The user_id guard fires before any DB call.
        Anonymous users browsing the chat cannot read board lists.
        """
        from agent.tools import execute_tool
        db = MagicMock()
        result, hint = _run(execute_tool("list_boards", {}, user_id=None, session_id=1, db=db))
        assert result["reason"] == "not_logged_in"
        assert result["boards"] == []
        assert hint is None

    def test_list_boards_returns_board_list(self):
        """
        Logged-in user → memory_list_boards is called and its result is wrapped
        as {"boards": [...]}. The event type hint is None (not a UI tree).
        """
        from agent.tools import execute_tool
        boards_data = [{"id": 1, "name": "My Home", "description": None,
                        "note_count": 2, "product_count": 5, "created_at": None, "updated_at": None}]
        db = MagicMock()
        with patch("agent.tools.memory_list_boards", AsyncMock(return_value=boards_data)):
            result, hint = _run(execute_tool("list_boards", {}, user_id=10, session_id=1, db=db))
        assert result["boards"] == boards_data
        assert hint is None

    # ── create_board ─────────────────────────────────────────────────────────

    def test_create_board_requires_login(self):
        """
        user_id=None → {"created": False, "reason": "not_logged_in"}.
        """
        from agent.tools import execute_tool
        db = MagicMock()
        result, _ = _run(execute_tool("create_board", {"name": "x"}, user_id=None, session_id=1, db=db))
        assert result["created"] is False
        assert result["reason"] == "not_logged_in"

    def test_create_board_propagates_value_error(self):
        """
        If memory_create_board raises ValueError (e.g., cap reached), execute_tool
        catches it and returns {"created": False, "reason": "..."} instead of re-raising.
        Mason receives the error as a tool result and tells the user — the agent loop
        does not crash.
        """
        from agent.tools import execute_tool
        db = MagicMock()
        with patch("agent.tools.memory_create_board",
                   AsyncMock(side_effect=ValueError("board limit reached (50)"))):
            result, _ = _run(execute_tool("create_board", {"name": "x"}, user_id=10, session_id=1, db=db))
        assert result["created"] is False
        assert "board limit reached" in result["reason"]

    def test_create_board_returns_created_board(self):
        """
        Happy path: memory_create_board returns a board dict →
        execute_tool wraps it as {"created": True, "board": {...}}.
        """
        from agent.tools import execute_tool
        board_data = {"id": 5, "name": "Mom Gift", "description": "Birthday ideas",
                      "note_count": 0, "product_count": 0, "created_at": None, "updated_at": None}
        db = MagicMock()
        with patch("agent.tools.memory_create_board", AsyncMock(return_value=board_data)):
            result, hint = _run(execute_tool(
                "create_board", {"name": "Mom Gift", "description": "Birthday ideas"},
                user_id=10, session_id=1, db=db,
            ))
        assert result["created"] is True
        assert result["board"]["id"] == 5
        assert hint is None

    # ── save_to_board ────────────────────────────────────────────────────────

    def test_save_to_board_requires_login(self):
        """
        user_id=None → {"saved": False, "reason": "not_logged_in"}.
        """
        from agent.tools import execute_tool
        db = MagicMock()
        result, _ = _run(execute_tool("save_to_board", {"product_id": 42}, user_id=None, session_id=1, db=db))
        assert result["saved"] is False

    def test_save_to_board_uses_board_id_directly(self):
        """
        tool_input contains board_id → memory_save_product_to_board called with that board_id.
        No board-name lookup or default-board creation needed.
        """
        from agent.tools import execute_tool
        db = MagicMock()
        with patch("agent.tools.memory_save_product_to_board", AsyncMock(return_value=True)) as mock_save:
            result, _ = _run(execute_tool(
                "save_to_board", {"product_id": 42, "board_id": 3},
                user_id=10, session_id=1, db=db,
            ))
        mock_save.assert_called_once_with(10, 3, 42, db)
        assert result["saved"] is True
        assert result["board_id"] == 3

    def test_save_to_board_looks_up_board_by_name(self):
        """
        tool_input contains board_name → memory_find_board_by_name is called first.
        If found, memory_save_product_to_board is called with the resolved board_id.
        Mason often knows board name from conversation but not the numeric id.
        """
        from agent.tools import execute_tool
        db = MagicMock()
        with patch("agent.tools.memory_find_board_by_name", AsyncMock(return_value={"id": 7})), \
             patch("agent.tools.memory_save_product_to_board", AsyncMock(return_value=True)) as mock_save:
            result, _ = _run(execute_tool(
                "save_to_board", {"product_id": 42, "board_name": "My Home"},
                user_id=10, session_id=1, db=db,
            ))
        mock_save.assert_called_once_with(10, 7, 42, db)
        assert result["board_id"] == 7

    def test_save_to_board_creates_board_when_name_not_found(self):
        """
        board_name given but not found → memory_create_board is called to create it,
        then save proceeds with the new board's id.
        Mason can auto-create boards when the user names a new shopping context.
        """
        from agent.tools import execute_tool
        db = MagicMock()
        with patch("agent.tools.memory_find_board_by_name", AsyncMock(return_value=None)), \
             patch("agent.tools.memory_create_board", AsyncMock(return_value={"id": 12})) as mock_create, \
             patch("agent.tools.memory_save_product_to_board", AsyncMock(return_value=True)):
            result, _ = _run(execute_tool(
                "save_to_board", {"product_id": 42, "board_name": "Future Life"},
                user_id=10, session_id=1, db=db,
            ))
        mock_create.assert_called_once_with(10, "Future Life", None, db)
        assert result["board_id"] == 12

    def test_save_to_board_falls_back_to_default(self):
        """
        No board_id and no board_name → memory_get_or_create_default_board called.
        The product lands in the user's default "Saved" board.
        This is the fallback when Mason has no board context.
        """
        from agent.tools import execute_tool
        db = MagicMock()
        with patch("agent.tools.memory_get_or_create_default_board", AsyncMock(return_value={"id": 1})) as mock_default, \
             patch("agent.tools.memory_save_product_to_board", AsyncMock(return_value=True)):
            result, _ = _run(execute_tool(
                "save_to_board", {"product_id": 42},
                user_id=10, session_id=1, db=db,
            ))
        mock_default.assert_called_once_with(10, db)
        assert result["saved"] is True

    # ── save_note_to_board ───────────────────────────────────────────────────

    def test_save_note_to_board_requires_login(self):
        """
        user_id=None → {"saved": False, "reason": "not_logged_in"}.
        """
        from agent.tools import execute_tool
        db = MagicMock()
        result, _ = _run(execute_tool("save_note_to_board", {"board_id": 1, "text": "x"},
                                       user_id=None, session_id=1, db=db))
        assert result["saved"] is False

    def test_save_note_to_board_falls_back_to_default_board(self):
        """
        tool_input missing board_id → falls back to get_or_create_default_board.
        board_id is now optional; omitting it saves the note to My Board.
        """
        from agent.tools import execute_tool
        from unittest.mock import patch, AsyncMock
        db = MagicMock()
        default_board = {"id": 7, "name": "My Board", "is_default": True}
        note_result = {"id": 1, "board_id": 7, "text": "nice rug", "created_at": None}
        with patch("agent.tools.memory_get_or_create_default_board", AsyncMock(return_value=default_board)), \
             patch("agent.tools.memory_add_note_to_board", AsyncMock(return_value=note_result)):
            result, _ = _run(execute_tool("save_note_to_board", {"text": "nice rug"},
                                          user_id=10, session_id=1, db=db))
        assert result["saved"] is True

    def test_save_note_to_board_propagates_value_error(self):
        """
        memory_add_note_to_board raises ValueError (e.g., board not found) →
        execute_tool returns {"saved": False, "reason": "board 99 not found"}.
        Agent loop does not crash; Mason informs the user.
        """
        from agent.tools import execute_tool
        db = MagicMock()
        with patch("agent.tools.memory_add_note_to_board",
                   AsyncMock(side_effect=ValueError("board 99 not found"))):
            result, _ = _run(execute_tool(
                "save_note_to_board", {"board_id": 99, "text": "test"},
                user_id=10, session_id=1, db=db,
            ))
        assert result["saved"] is False
        assert "99" in result["reason"]

    def test_save_note_to_board_succeeds(self):
        """
        Happy path: memory_add_note_to_board returns note dict →
        execute_tool returns {"saved": True, "note": {...}}.
        """
        from agent.tools import execute_tool
        note_data = {"id": 3, "board_id": 1, "text": "wants earthy tones", "created_at": None}
        db = MagicMock()
        with patch("agent.tools.memory_add_note_to_board", AsyncMock(return_value=note_data)):
            result, hint = _run(execute_tool(
                "save_note_to_board", {"board_id": 1, "text": "wants earthy tones"},
                user_id=10, session_id=1, db=db,
            ))
        assert result["saved"] is True
        assert result["note"]["id"] == 3
        assert hint is None

    # ── ask_save_to_board ────────────────────────────────────────────────────

    def test_ask_save_to_board_requires_login(self):
        """
        user_id=None → {"saved": False, "reason": "not_logged_in"}.
        """
        from agent.tools import execute_tool
        db = MagicMock()
        result, _ = _run(execute_tool("ask_save_to_board",
                                       {"product_id": 5, "product_name": "Rug"},
                                       user_id=None, session_id=1, db=db))
        assert result["saved"] is False

    def test_ask_save_to_board_renders_board_picker_ui_tree(self):
        """
        Happy path: two boards exist → execute_tool returns a raw A2UI payload
        with event type "ui_tree" so the streaming loop sends it to the frontend.

        Checks:
        1. Second return value is "ui_tree" — not None (which would skip rendering).
        2. Payload has "root" and "components" keys.
        3. components[0]["type"] == "board_picker".
        4. props["product_name"] matches the input.
        5. props["boards"] contains both mocked boards.

        If ui_tree hint is missing, the frontend never renders the picker
        and the user sees nothing — they can't save the product to a board.
        """
        from agent.tools import execute_tool
        boards_data = [
            {"id": 1, "name": "My Home", "description": "Home decor"},
            {"id": 2, "name": "Mom Gift", "description": "Birthday ideas"},
        ]
        db = MagicMock()
        with patch("agent.tools.memory_list_boards", AsyncMock(return_value=boards_data)):
            result, hint = _run(execute_tool(
                "ask_save_to_board", {"product_id": 5, "product_name": "Wool Rug"},
                user_id=10, session_id=1, db=db,
            ))

        assert hint == "ui_tree"
        assert "root" in result
        assert "components" in result
        comp = result["components"][0]
        assert comp["type"] == "board_picker"
        assert comp["props"]["product_name"] == "Wool Rug"
        assert comp["props"]["product_id"] == 5
        assert len(comp["props"]["boards"]) == 2

    def test_ask_save_to_board_creates_default_when_no_boards(self):
        """
        No boards exist → get_or_create_default_board called, picker renders
        with the single default board. New users still get a picker (with one option)
        rather than an error.
        """
        from agent.tools import execute_tool
        default_board = {"id": 1, "name": "Saved", "description": "Your saved items"}
        db = MagicMock()
        with patch("agent.tools.memory_list_boards", AsyncMock(return_value=[])), \
             patch("agent.tools.memory_get_or_create_default_board",
                   AsyncMock(return_value=default_board)):
            result, hint = _run(execute_tool(
                "ask_save_to_board", {"product_id": 5, "product_name": "Candle"},
                user_id=10, session_id=1, db=db,
            ))

        assert hint == "ui_tree"
        assert len(result["components"][0]["props"]["boards"]) == 1
        assert result["components"][0]["props"]["boards"][0]["name"] == "Saved"


# ─────────────────────────────────────────────────────────────────────────────
# Group 8: save_product backward-compat re-routing
# ─────────────────────────────────────────────────────────────────────────────

class TestSaveProductBackwardCompat:
    """
    The old save_product tool now routes through the boards system.
    It must call memory_get_or_create_default_board then memory_save_product_to_board
    instead of the legacy memory_save_product (flat SavedProduct table).
    If this breaks, saved products don't appear in any board.
    """

    def test_save_product_routes_to_board_not_legacy_table(self):
        """
        execute_tool("save_product", ...) must call memory_save_product_to_board
        and must NOT call the legacy memory_save_product function.

        This is the backward-compat bridge: existing Mason prompts that still
        emit save_product go through the new boards system automatically.
        """
        from agent.tools import execute_tool
        db = MagicMock()
        with patch("agent.tools.memory_get_or_create_default_board",
                   AsyncMock(return_value={"id": 1})), \
             patch("agent.tools.memory_save_product_to_board",
                   AsyncMock(return_value=True)) as mock_board_save, \
             patch("agent.tools.memory_save_product",
                   AsyncMock(return_value=True)) as mock_legacy:
            _run(execute_tool("save_product", {"product_id": 42},
                               user_id=10, session_id=1, db=db))

        mock_board_save.assert_called_once()
        mock_legacy.assert_not_called()

    def test_save_product_returns_saved_true(self):
        """
        Happy path end-to-end: default board resolved, product saved,
        returns {"saved": True, "product_id": 42, "newly_saved": True}.
        The response shape must be unchanged so existing chat UI code
        that checks result["saved"] still works.
        """
        from agent.tools import execute_tool
        db = MagicMock()
        with patch("agent.tools.memory_get_or_create_default_board",
                   AsyncMock(return_value={"id": 1})), \
             patch("agent.tools.memory_save_product_to_board",
                   AsyncMock(return_value=True)):
            result, hint = _run(execute_tool(
                "save_product", {"product_id": 42},
                user_id=10, session_id=1, db=db,
            ))

        assert result["saved"] is True
        assert result["product_id"] == 42
        assert result["newly_saved"] is True
        assert hint is None
