from collections.abc import Callable
from enum import Enum
from typing import Any

from app.projects import project_schemas
from app.users.user_deps import login_dependency
from app.users.user_schemas import DbUser
from fastapi import Depends, HTTPException, status
from pydantic import BaseModel


class PermissionType(str, Enum):
    VIEW = "view"
    CREATE = "create"
    EDIT = "update"
    DELETE = "delete"
    UPLOAD = "upload"
    MANAGE = "manage"


class BasePermission:
    """Base class for all permissions"""

    error_message = "Permission denied"

    async def has_permission(self, user: DbUser | None, obj: Any | None = None) -> bool:
        raise NotImplementedError

    async def __call__(self, user: DbUser | None, obj: Any | None = None) -> bool:
        return await self.has_permission(user, obj)

    def __or__(self, other: "BasePermission") -> "OrPermission":
        return OrPermission(self, other)

    def __and__(self, other: "BasePermission") -> "AndPermission":
        return AndPermission(self, other)


class OrPermission(BasePermission):
    """Logical OR combination of permissions"""

    def __init__(self, *permissions: BasePermission):
        self.permissions = permissions
        self.error_message = " or ".join(p.error_message for p in permissions)

    async def has_permission(
        self, user: DbUser | None, obj: BaseModel | None = None
    ) -> bool:
        # Use asyncio.gather to run permissions checks concurrently
        results = []
        for permission in self.permissions:
            result = await permission.has_permission(user, obj)
            results.append(result)
        return any(results)


class AndPermission(BasePermission):
    """Logical AND combination of permissions"""

    def __init__(self, *permissions: BasePermission):
        self.permissions = permissions
        self.error_message = " and ".join(p.error_message for p in permissions)

    async def has_permission(
        self, user: DbUser | None, obj: BaseModel | None = None
    ) -> bool:
        # Use asyncio.gather to run permissions checks concurrently
        results = []
        for permission in self.permissions:
            result = await permission.has_permission(user, obj)
            results.append(result)
        return all(results)


class IsSuperUser(BasePermission):
    error_message = "You must be a superuser"

    async def has_permission(self, user: DbUser | None, obj: Any | None = None) -> bool:
        return user and user.is_superuser


class IsAuthenticated(BasePermission):
    error_message = "You must be authenticated"

    async def has_permission(self, user: DbUser | None, obj: Any | None = None) -> bool:
        return user is not None


class IsProjectCreator(BasePermission):
    """Check if user is the creator of a project"""

    async def has_permission(
        self, user: DbUser | None, obj: project_schemas.DbProject | None = None
    ) -> bool:
        if not user:
            return False

        if not isinstance(obj, project_schemas.DbProject):
            return False

        return obj.author_id == user.id


class HasObjectPermission(BasePermission):
    def __init__(self, permission_type: PermissionType | str):
        self.permission_type = (
            permission_type.value
            if isinstance(permission_type, PermissionType)
            else permission_type
        )
        self.error_message = f"Missing required permission: {self.permission_type}"

    async def has_permission(self, user: DbUser | None, obj: Any | None = None) -> bool:
        if not user:
            return False

        if user.is_superuser:
            return True

        if not obj:
            return False

        permissions = await self.get_user_permissions(user.id, obj)
        return self.permission_type in permissions

    async def get_user_permissions(self, user_id: int, obj: BaseModel) -> list[str]:
        # Implement actual permission checking logic here
        return []


def check_permissions(
    *permissions: BasePermission, get_obj: Callable | None = None
) -> Callable:
    async def dependency(
        user: DbUser = Depends(login_dependency),
        obj: Any | None = Depends(get_obj) if get_obj else None,
    ) -> Any:
        for permission in permissions:
            if not await permission.has_permission(user, obj):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=permission.error_message,
                )
        return obj

    return dependency
