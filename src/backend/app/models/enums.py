"""Enum definitions to translate values into human enum strings."""

from enum import Enum


class StrEnum(str, Enum):
    """Wrapper for string enums, until Python 3.11 upgrade."""

    pass


class IntEnum(int, Enum):
    """Wrapper for string enums, until Python 3.11 upgrade."""

    pass


class TaskStatus(IntEnum, Enum):
    """Enum describing available Task Statuses."""

    READY = 0
    LOCKED_FOR_MAPPING = 1
    MAPPED = 2
    LOCKED_FOR_VALIDATION = 3
    VALIDATED = 4
    INVALIDATED = 5
    BAD = 6  # Task cannot be mapped
    SPLIT = 7  # Task has been split


class TaskAction(IntEnum, Enum):
    """All possible task actions, recorded in task history."""

    RELEASED_FOR_MAPPING = 0
    LOCKED_FOR_MAPPING = 1
    MARKED_MAPPED = 2
    LOCKED_FOR_VALIDATION = 3
    VALIDATED = 4
    MARKED_INVALID = 5
    MARKED_BAD = 6  # Task cannot be mapped
    SPLIT_NEEDED = 7  # Task needs split
    RECREATED = 8
    COMMENT = 9


class TaskSplitType(IntEnum, Enum):
    """Enum describing task splitting type."""

    DIVIDE_ON_SQUARE = 0
    CHOOSE_AREA_AS_TASK = 1
    TASK_SPLITTING_ALGORITHM = 2


class ProjectStatus(IntEnum, Enum):
    """Enum to describes all possible states of a Mapping Project."""

    ARCHIVED = 0
    PUBLISHED = 1
    DRAFT = 2


class ProjectVisibility(IntEnum, Enum):
    """Enum describing task splitting type."""

    PUBLIC = 0
    PRIVATE = 1
    INVITE_ONLY = 2


class MappingLevel(IntEnum, Enum):
    """The mapping level the mapper has achieved."""

    BEGINNER = 1
    INTERMEDIATE = 2
    ADVANCED = 3


class ProjectPriority(IntEnum, Enum):
    """Enum to describe all possible project priority levels."""

    URGENT = 0
    HIGH = 1
    MEDIUM = 2
    LOW = 3
