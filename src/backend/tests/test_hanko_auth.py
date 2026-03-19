"""Tests for Hanko SSO authentication."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.users.hanko_helpers import lookup_user_by_email, create_drone_tm_user


class TestLookupUserByEmail:
    """Tests for email-based user lookup."""

    @pytest.mark.asyncio
    async def test_finds_existing_user(self):
        mock_db = MagicMock()
        mock_user = {"id": "12345", "email_address": "test@example.com"}

        with patch(
            "app.users.hanko_helpers.DbUser.get_user_by_email",
            new_callable=AsyncMock,
            return_value=mock_user,
        ):
            result = await lookup_user_by_email(mock_db, "test@example.com")

        assert result == "12345"

    @pytest.mark.asyncio
    async def test_returns_none_for_missing(self):
        mock_db = MagicMock()

        with patch(
            "app.users.hanko_helpers.DbUser.get_user_by_email",
            new_callable=AsyncMock,
            return_value=None,
        ):
            result = await lookup_user_by_email(mock_db, "nonexistent@example.com")

        assert result is None


class TestCreateDroneTmUser:
    """Tests for user creation from Hanko user."""

    @pytest.mark.asyncio
    async def test_creates_user_with_email_username(self):
        mock_db = MagicMock()
        mock_hanko_user = MagicMock()
        mock_hanko_user.id = "hanko-uuid-123"
        mock_hanko_user.email = "johndoe@example.com"

        mock_created_user = MagicMock()
        mock_created_user.id = "new-user-id-456"

        with patch(
            "app.users.hanko_helpers.DbUser.create",
            new_callable=AsyncMock,
            return_value=mock_created_user,
        ) as mock_create:
            result = await create_drone_tm_user(mock_db, mock_hanko_user)

        call_args = mock_create.call_args
        auth_user = call_args[0][1]
        assert auth_user.name == "johndoe"
        assert auth_user.email == "johndoe@example.com"
        assert auth_user.role == "MAPPER"
        assert result == "new-user-id-456"

    @pytest.mark.asyncio
    async def test_generates_uuid_for_user_id(self):
        mock_db = MagicMock()
        mock_hanko_user = MagicMock()
        mock_hanko_user.id = "hanko-uuid-789"
        mock_hanko_user.email = "newuser@test.org"

        mock_created_user = MagicMock()
        mock_created_user.id = "generated-id"

        with patch(
            "app.users.hanko_helpers.DbUser.create",
            new_callable=AsyncMock,
            return_value=mock_created_user,
        ) as mock_create:
            await create_drone_tm_user(mock_db, mock_hanko_user)

        call_args = mock_create.call_args
        auth_user = call_args[0][1]
        assert auth_user.id.isdigit()

    @pytest.mark.asyncio
    async def test_extracts_username_from_email(self):
        mock_db = MagicMock()
        mock_hanko_user = MagicMock()
        mock_hanko_user.id = "test-id"
        mock_hanko_user.email = "my.username@domain.com"

        mock_created_user = MagicMock()
        mock_created_user.id = "123"

        with patch(
            "app.users.hanko_helpers.DbUser.create",
            new_callable=AsyncMock,
            return_value=mock_created_user,
        ) as mock_create:
            await create_drone_tm_user(mock_db, mock_hanko_user)

        call_args = mock_create.call_args
        auth_user = call_args[0][1]
        assert auth_user.name == "my.username"
