from enum import Enum
from typing import Any, Callable, List, Optional, Union

from fastapi import Depends, HTTPException, status
from pydantic import BaseModel

from app.projects import project_schemas
from app.users.user_deps import login_dependency
from app.users.user_schemas import DbUser


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

    async def has_permission(
        self, user: Optional[DbUser], obj: Optional[Any] = None
    ) -> bool:
        raise NotImplementedError

    async def __call__(self, user: Optional[DbUser], obj: Optional[Any] = None) -> bool:
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
        self, user: Optional[DbUser], obj: Optional[BaseModel] = None
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
        self, user: Optional[DbUser], obj: Optional[BaseModel] = None
    ) -> bool:
        # Use asyncio.gather to run permissions checks concurrently
        results = []
        for permission in self.permissions:
            result = await permission.has_permission(user, obj)
            results.append(result)
        return all(results)


class IsSuperUser(BasePermission):
    error_message = "You must be a superuser"

    async def has_permission(
        self, user: Optional[DbUser], obj: Optional[Any] = None
    ) -> bool:
        print("user", user)
        return user and user.is_superuser


class IsAuthenticated(BasePermission):
    error_message = "You must be authenticated"

    async def has_permission(
        self, user: Optional[DbUser], obj: Optional[Any] = None
    ) -> bool:
        return user is not None


class IsProjectCreator(BasePermission):
    """Check if user is the creator of a project"""

    async def has_permission(
        self, user: Optional[DbUser], obj: Optional[project_schemas.DbProject] = None
    ) -> bool:
        if not user:
            return False

        if not isinstance(obj, project_schemas.DbProject):
            return False

        return obj.author_id == user.id


class HasObjectPermission(BasePermission):
    def __init__(self, permission_type: Union[PermissionType, str]):
        self.permission_type = (
            permission_type.value
            if isinstance(permission_type, PermissionType)
            else permission_type
        )
        self.error_message = f"Missing required permission: {self.permission_type}"

    async def has_permission(
        self, user: Optional[DbUser], obj: Optional[Any] = None
    ) -> bool:
        if user.is_superuser:
            return True

        if not user or not obj:
            return False

        permissions = await self.get_user_permissions(user.id, obj)
        return self.permission_type in permissions

    async def get_user_permissions(self, user_id: int, obj: BaseModel) -> List[str]:
        # Implement actual permission checking logic here
        return []


def check_permissions(
    *permissions: BasePermission, get_obj: Optional[Callable] = None
) -> Callable:
    async def dependency(
        user: DbUser = Depends(login_dependency),
        obj: Optional[Any] = Depends(get_obj) if get_obj else None,
    ) -> Any:
        for permission in permissions:
            if not await permission.has_permission(user, obj):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=permission.error_message,
                )
        return obj

    return dependency
