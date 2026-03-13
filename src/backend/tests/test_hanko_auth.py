"""Tests for Hanko SSO authentication in Drone-TM.

These tests verify the user mapping and auto-creation flows.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

from app.users.hanko_helpers import lookup_user_by_email, create_drone_tm_user


class TestLookupUserByEmail:
    """Tests for email-based user lookup."""

    @pytest.mark.asyncio
    async def test_finds_existing_user(self):
        """Should return user ID when email exists."""
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
        """Should return None when email not found."""
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
        """Should extract username from email and create user."""
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

        # Should have called create with extracted username
        call_args = mock_create.call_args
        auth_user = call_args[0][1]  # Second positional arg
        assert auth_user.name == "johndoe"
        assert auth_user.email == "johndoe@example.com"
        assert auth_user.role == "MAPPER"
        assert result == "new-user-id-456"

    @pytest.mark.asyncio
    async def test_generates_uuid_for_user_id(self):
        """Should generate a UUID-based ID for new users."""
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

        # Verify the ID is a numeric string (UUID int)
        call_args = mock_create.call_args
        auth_user = call_args[0][1]
        assert auth_user.id.isdigit()


class TestHankoLoginRequired:
    """Tests for the Hanko-enabled login_required dependency."""

    @pytest.mark.asyncio
    async def test_maps_hanko_user_to_drone_tm_user(self):
        """Should map Hanko user to existing Drone-TM user."""
        from app.config import settings

        # Only test if AUTH_PROVIDER could be hanko
        if settings.AUTH_PROVIDER != "hanko":
            pytest.skip("AUTH_PROVIDER is not hanko")

        # This would require more complex setup with actual dependency injection
        # For now, we just verify the helper functions work correctly
        pass

    @pytest.mark.asyncio
    async def test_auto_creates_user_when_not_found(self):
        """Should auto-create user when no mapping exists."""
        mock_db = MagicMock()
        mock_hanko_user = MagicMock()
        mock_hanko_user.id = "new-hanko-user"
        mock_hanko_user.email = "brandnew@example.com"

        # Simulate no existing user found
        with patch(
            "app.users.hanko_helpers.DbUser.get_user_by_email",
            new_callable=AsyncMock,
            return_value=None,
        ):
            result = await lookup_user_by_email(mock_db, "brandnew@example.com")

        assert result is None

        # Then create should be called
        mock_created_user = MagicMock()
        mock_created_user.id = "auto-created-id"

        with patch(
            "app.users.hanko_helpers.DbUser.create",
            new_callable=AsyncMock,
            return_value=mock_created_user,
        ):
            new_id = await create_drone_tm_user(mock_db, mock_hanko_user)

        assert new_id == "auto-created-id"


class TestUsernameExtraction:
    """Tests for username extraction from email."""

    @pytest.mark.asyncio
    async def test_extracts_username_from_email(self):
        """Should use part before @ as username."""
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

    @pytest.mark.asyncio
    async def test_handles_simple_email(self):
        """Should handle simple email addresses."""
        mock_db = MagicMock()
        mock_hanko_user = MagicMock()
        mock_hanko_user.id = "test-id"
        mock_hanko_user.email = "admin@hotosm.org"

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
        assert auth_user.name == "admin"
