"""Enum definitions to translate values into human enum strings."""

from enum import Enum


class StrEnum(str, Enum):
    """Wrapper for string enums, until Python 3.11 upgrade."""

    pass


class IntEnum(int, Enum):
    """Wrapper for string enums, until Python 3.11 upgrade."""

    pass


class FinalOutput(StrEnum):
    ORTHOPHOTO_2D = "ORTHOPHOTO_2D"
    ORTHOPHOTO_3D = "ORTHOPHOTO_3D"
    DIGITAL_TERRAIN_MODEL = "DIGITAL_TERRAIN_MODEL"
    DIGITAL_SURFACE_MODEL = "DIGITAL_SURFACE_MODEL"


class TaskSplitType(IntEnum):
    """Enum describing task splitting type."""

    DIVIDE_ON_SQUARE = 0
    CHOOSE_AREA_AS_TASK = 1
    TASK_SPLITTING_ALGORITHM = 2


class ProjectStatus(IntEnum):
    """Enum to describe all possible states of a Drone Project."""

    ARCHIVED = 0
    PUBLISHED = 1
    DRAFT = 2


class RegulatorApprovalStatus(IntEnum):
    """Enum to describe all possible state of a Project from Regulator"""

    PENDING = 0
    APPROVED = 1
    REJECTED = 2


class ImageProcessingStatus(IntEnum):
    """Enum to describe all possible statys of a Image Processing for a Project"""

    NOT_STARTED = 0
    PROCESSING = 1
    SUCCESS = 2
    FAILED = 3


class ProjectVisibility(IntEnum):
    """Enum describing task splitting type."""

    PUBLIC = 0
    PRIVATE = 1
    INVITE_ONLY = 2


class MappingLevel(IntEnum):
    """The experience level the drone operator has achieved."""

    BEGINNER = 1
    INTERMEDIATE = 2
    ADVANCED = 3


class ProjectPriority(IntEnum):
    """Enum to describe all possible project priority levels."""

    URGENT = 0
    HIGH = 1
    MEDIUM = 2
    LOW = 3


class HTTPStatus(IntEnum):
    """All HTTP status codes used in endpoints."""

    # Success
    OK = 200
    CREATED = 201
    ACCEPTED = 202
    NO_CONTENT = 204

    # Client Error
    BAD_REQUEST = 400
    UNAUTHORIZED = 401
    FORBIDDEN = 403
    NOT_FOUND = 404
    CONFLICT = 409
    UNPROCESSABLE_ENTITY = 422

    # Server Error
    INTERNAL_SERVER_ERROR = 500
    NOT_IMPLEMENTED = 501


class UserRole(IntEnum):
    PROJECT_CREATOR = 1
    DRONE_PILOT = 2
    REGULATOR = 3


class State(IntEnum):
    """The state of a task.

    This is determined from the most recent entry in `task_events`
    for a given task.

    The state can be:
    - AWAITING_APPROVAL: someone requested to fly the task (pending approval).
    - UNLOCKED: default status, ready to fly.
    - LOCKED: locked by a user that is about to fly the task.
    - FULLY_FLOWN: flown in the field, not yet uploaded.
    - HAS_IMAGERY: imagery has been classified/uploaded for the task.
    - READY_FOR_PROCESSING: user marked task ready for ODM processing.
    - HAS_ISSUES: task has issues (unflyable, needs redo, etc.).
    - IMAGE_PROCESSING_FAILED: failed processing in ODM.
    - IMAGE_PROCESSING_STARTED: started processing in ODM.
    - IMAGE_PROCESSING_FINISHED: successful processing in ODM.
    """

    AWAITING_APPROVAL = -1
    UNLOCKED = 0
    LOCKED = 1
    FULLY_FLOWN = 2
    HAS_IMAGERY = 3
    READY_FOR_PROCESSING = 4
    HAS_ISSUES = 5
    IMAGE_PROCESSING_FAILED = 7
    IMAGE_PROCESSING_STARTED = 8
    IMAGE_PROCESSING_FINISHED = 9


class EventType(StrEnum):
    """Events that can be used via the API to update a state.

    Specify the event type for ``POST`` to:
    ``/project/{pid}/event`` .

    Possible values are:

    - ``request`` -- Request to fly a task (may need approval).
    - ``fly`` -- Approve/lock the task for flying.
    - ``mark_flown`` -- Mark a locked task as fully flown.
    - ``reject`` -- Reject a flight request.
    - ``mark_issue`` -- Mark a task as having issues.
    - ``assign`` -- Assign a task to another user.
    - ``comment`` -- Add a comment without changing state.
    - ``unlock`` -- Unlock a locked task.
    - ``split`` -- Split a task (TODO: not yet implemented).
    - ``image_processing_start`` -- Start image processing in ODM.
    - ``unmark_flown`` -- Revert a fully flown task back to locked.

    Note that ``task_id`` must be specified in the endpoint too.
    """

    REQUEST = "request"
    REJECT = "reject"
    FLY = "fly"
    MARK_FLOWN = "mark_flown"
    UNMARK_FLOWN = "unmark_flown"
    MARK_ISSUE = "mark_issue"
    SPLIT = "split"
    ASSIGN = "assign"
    COMMENT = "comment"
    UNLOCK = "unlock"
    IMAGE_PROCESSING_START = "image_processing_start"


class ProjectCompletionStatus(StrEnum):
    """Enum to describe all possible project completion status."""

    NOT_STARTED = "not-started"
    ON_GOING = "ongoing"
    COMPLETED = "completed"


class OAMUploadStatus(StrEnum):
    """Enum to describe all possible OAM upload status."""

    NOT_STARTED = "not-started"
    UPLOADING = "uploading"
    UPLOADED = "uploaded"
    FAILED = "failed"


class ImageStatus(StrEnum):
    """Enum to describe the status of uploaded project images."""

    STAGED = (
        "staged"  # Files uploaded but not yet committed (multipart upload in progress)
    )
    UPLOADED = "uploaded"  # Successfully uploaded to S3, pending classification
    CLASSIFYING = "classifying"  # Currently being classified
    ASSIGNED = "assigned"  # Assigned to a task after successful classification
    REJECTED = "rejected"  # Failed quality checks (blur, gimbal angle, etc.)
    UNMATCHED = "unmatched"  # GPS coordinates don't match any task boundary
    INVALID_EXIF = "invalid_exif"  # EXIF data is missing or unreadable
    DUPLICATE = "duplicate"  # Duplicate image (same hash as existing image)
