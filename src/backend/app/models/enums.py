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
    """Enum to describes all possible states of a Mapping Project."""

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
    """The mapping level the mapper has achieved."""

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
    - REQUEST_FOR_MAPPING: someone was request to map the task.
    - UNLOCKED_TO_MAP: default status, ready to fly.
    - LOCKED_FOR_MAPPING: locked by a user that is about to fly the task.
    - ~UNLOCKED_TO_VALIDATE~: flying complete, requires validation (not used yet).
    - ~LOCKED_FOR_VALIDATION~: currently being validated (not used yet).
    - ~UNLOCKED_DONE~: task is complete and validated (currently not used).
    - UNFLYABLE_TASK: not possibly to fly - marked bad.
    - IMAGE_UPLOADED: imagery has been uploaded for the task.
    - IMAGE_PROCESSING_FAILED: failed processing in ODM.
    - IMAGE_PROCESSING_STARTED: started processing in ODM.
    - IMAGE_PROCESSING_FINISHED: successful processing in ODM.
    """

    REQUEST_FOR_MAPPING = -1
    UNLOCKED_TO_MAP = 0
    LOCKED_FOR_MAPPING = 1
    UNLOCKED_TO_VALIDATE = 2
    LOCKED_FOR_VALIDATION = 3
    UNLOCKED_DONE = 4
    UNFLYABLE_TASK = 5
    IMAGE_UPLOADED = 6
    IMAGE_PROCESSING_FAILED = 7
    IMAGE_PROCESSING_STARTED = 8
    IMAGE_PROCESSING_FINISHED = 9


class EventType(StrEnum):
    """Events that can be used via the API to update a state

    Specify the event type for ``POST`` to:
    ``/project/{pid}/event`` .

    Possible values are:

    - ``request`` -- Request a task to be mapped.
    - ``map`` -- Set to *locked for mapping*, i.e. mapping in progress.
    - ``finish`` -- Set to *unlocked to validate*, i.e. is mapped.
    - ``validate`` -- Request recent task ready to be validate.
    - ``good`` -- Set the state to *unlocked done*.
    - ``bad`` -- Set the state *unlocked to map* again, to be mapped once again.
    - ``split`` -- Set the state *unlocked done* then generate additional subdivided task areas.
    - ``assign`` -- For a requester user to assign a task to another user. Set the state *locked for mapping* passing in the required user id.
    - ``comment`` -- Keep the state the same, but simply add a comment.
    - ``unlock`` -- Unlock a task state by unlocking it if it's locked.
    - ``image_upload`` -- Set the state to *image uploaded* when the task image is uploaded.
    - ``image_processing_start`` -- Set the state to *image processing started* when the image processing is started by user.

    Note that ``task_id`` must be specified in the endpoint too.
    """

    REQUESTS = "request"
    REJECTED = "reject"
    MAP = "map"
    FINISH = "finish"
    VALIDATE = "validate"
    GOOD = "good"
    BAD = "bad"
    SPLIT = "split"
    ASSIGN = "assign"
    COMMENT = "comment"
    UNLOCK = "unlock"
    IMAGE_UPLOAD = "image_upload"
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
