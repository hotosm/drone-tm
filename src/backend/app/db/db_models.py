from datetime import datetime
from typing import cast

from geoalchemy2 import Geometry, WKBElement
from sqlalchemy import (
    ARRAY,
    Boolean,
    CHAR,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import (
    declarative_base,
    object_session,
    relationship,
)

from app.models.enums import (
    FinalOutput,
    ImageProcessingStatus,
    ImageStatus,
    OAMUploadStatus,
    ProjectStatus,
    ProjectVisibility,
    RegulatorApprovalStatus,
    State,
    TaskSplitType,
    TaskStatus,
    UserRole,
)
from app.utils import timestamp

Base = declarative_base()


class DbUser(Base):
    __tablename__ = "users"

    id = cast(str, Column(String, primary_key=True))
    email_address = cast(str, Column(String, nullable=False, unique=True))
    password = cast(str, Column(String))
    name = cast(str, Column(String))
    is_active = cast(bool, Column(Boolean, default=False))
    is_superuser = cast(bool, Column(Boolean, default=False))
    profile_img = cast(str, Column(String, nullable=True))
    date_registered = cast(datetime, Column(DateTime, default=timestamp))


class DbOrganisation(Base):
    """Describes an Organisation."""

    __tablename__ = "organisations"

    id = cast(int, Column(Integer, primary_key=True))
    name = cast(str, Column(String(512), nullable=False, unique=True))
    slug = cast(str, Column(String(255), nullable=False, unique=True))
    logo = cast(str, Column(String))  # URL of a logo
    description = cast(str, Column(String))
    url = cast(str, Column(String))


class DbTask(Base):
    """Describes an individual mapping Task."""

    __tablename__ = "tasks"

    # Table has composite PK on (id and project_id)
    id = cast(str, Column(UUID(as_uuid=True), primary_key=True))
    project_id = cast(
        str, Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    )
    project_task_index = cast(int, Column(Integer))
    outline = cast(WKBElement, Column(Geometry("POLYGON", srid=4326)))
    take_off_point = cast(
        WKBElement, Column(Geometry("POINT", srid=4326), nullable=True)
    )
    total_area_sqkm = cast(float, Column(Float, nullable=True))
    flight_time_minutes = cast(int, Column(Float, nullable=True))
    flight_distance_km = cast(float, Column(Float, nullable=True))
    total_image_uploaded = cast(int, Column(SmallInteger, nullable=True))
    assets_url = cast(
        str, Column(String, nullable=True)
    )  # download link for assets of images(orthophoto)


class DbProject(Base):
    """Describes a Mapping Project."""

    __tablename__ = "projects"

    id = cast(str, Column(UUID(as_uuid=True), primary_key=True))
    name = cast(str, Column(String))
    slug = cast(str, Column(String, unique=True, index=True, nullable=False))
    short_description = cast(str, Column(String))
    description = cast(str, Column(String))
    per_task_instructions = cast(str, Column(String))
    created_at = cast(datetime, Column(DateTime, default=timestamp, nullable=False))
    last_updated = cast(datetime, Column(DateTime, default=timestamp))
    deadline_at = cast(datetime, Column(DateTime, default=timestamp))
    # GEOMETRY
    outline = cast(WKBElement, Column(Geometry("POLYGON", srid=4326)))
    centroid = cast(WKBElement, Column(Geometry("POINT", srid=4326)))
    no_fly_zones = cast(WKBElement, Column(Geometry("MULTIPOLYGON", srid=4326)))

    organisation_id = cast(
        int,
        Column(
            Integer,
            ForeignKey("organisations.id", name="fk_organisations"),
            index=True,
        ),
    )
    organisation = relationship(DbOrganisation, backref="projects")

    # flight params
    front_overlap = cast(float, Column(Float, nullable=True))
    side_overlap = cast(float, Column(Float, nullable=True))
    gsd_cm_px = cast(float, Column(Float, nullable=True))  # in cm_px
    altitude_from_ground = cast(float, Column(Float, nullable=True))
    gsd_cm_px = cast(float, Column(Float, nullable=True))
    camera_bearings = cast(list[int], Column(ARRAY(SmallInteger), nullable=True))
    gimble_angles_degrees = cast(list, Column(ARRAY(SmallInteger), nullable=True))
    is_terrain_follow = cast(bool, Column(Boolean, default=False))
    dem_url = cast(str, Column(String, nullable=True))
    hashtags = cast(list, Column(ARRAY(String)))  # Project hashtag
    output_orthophoto_url = cast(str, Column(String, nullable=True))
    output_pointcloud_url = cast(str, Column(String, nullable=True))
    output_raw_url = cast(str, Column(String, nullable=True))

    # PROJECT CREATION
    author_id = cast(
        str,
        Column(
            String,
            ForeignKey("users.id", name="fk_users"),
            nullable=False,
        ),
    )
    author = relationship(DbUser, uselist=False, backref="user")
    final_output = cast(list, Column(ARRAY(Enum(FinalOutput))))
    requires_approval_from_manager_for_locking = cast(
        bool, Column(Boolean, default=False)
    )
    requires_approval_from_regulator = cast(bool, Column(Boolean, default=False))
    regulator_emails = cast(list, Column(ARRAY(String), nullable=True))
    # PROJECT STATUS
    status = cast(
        ProjectStatus,
        Column(Enum(ProjectStatus), default=ProjectStatus.DRAFT, nullable=False),
    )
    regulator_approval_status = cast(
        RegulatorApprovalStatus, Column(Enum(RegulatorApprovalStatus), nullable=True)
    )
    image_processing_status = cast(
        ImageProcessingStatus,
        Column(Enum(ImageProcessingStatus), default=ImageProcessingStatus.NOT_STARTED),
    )  # status of image processing
    oam_upload_status = cast(
        OAMUploadStatus,
        Column(Enum(OAMUploadStatus), default=OAMUploadStatus.NOT_STARTED),
    )  # status of oam upload

    regulator_comment = cast(str, Column(String, nullable=True))
    commenting_regulator_id = cast(
        str,
        Column(
            String,
            ForeignKey("users.id", name="fk_projects_commenting_regulator_id"),
            nullable=True,
        ),
    )
    commenting_regulator = relationship(DbUser, uselist=False, backref="regulator")
    visibility = cast(
        ProjectVisibility,
        Column(
            Enum(ProjectVisibility), default=ProjectVisibility.PUBLIC, nullable=False
        ),
    )

    task_split_type = cast(TaskSplitType, Column(Enum(TaskSplitType), nullable=True))
    task_split_dimension = cast(int, Column(SmallInteger, nullable=True))

    # TASKS
    total_tasks = cast(int, Column(Integer))
    tasks = relationship(
        DbTask, backref="projects", cascade="all, delete, delete-orphan"
    )

    __table_args__ = (
        Index("idx_geometry", outline, postgresql_using="gist"),
        {},
    )

    @property
    def tasks_mapped(self):
        """Get the number of tasks mapped for a project."""
        return (
            object_session(self)
            .query(DbTask)
            .filter(DbTask.task_status == TaskStatus.MAPPED)
            .with_parent(self)
            .count()
        )

    @property
    def tasks_validated(self):
        """Get the number of tasks validated for a project."""
        return (
            object_session(self)
            .query(DbTask)
            .filter(DbTask.task_status == TaskStatus.VALIDATED)
            .with_parent(self)
            .count()
        )

    @property
    def tasks_bad(self):
        """Get the number of tasks marked bad for a project."""
        return (
            object_session(self)
            .query(DbTask)
            .filter(DbTask.task_status == TaskStatus.BAD)
            .with_parent(self)
            .count()
        )


class DbProjectImage(Base):
    """Describes an uploaded image for a project."""

    __tablename__ = "project_images"

    id = cast(str, Column(UUID(as_uuid=True), primary_key=True))
    project_id = cast(
        str,
        Column(
            UUID(as_uuid=True),
            ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    task_id = cast(
        str,
        Column(
            UUID(as_uuid=True),
            ForeignKey("tasks.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    filename = cast(str, Column(Text, nullable=False))
    s3_key = cast(str, Column(Text, nullable=False))
    hash_md5 = cast(str, Column(CHAR(32), nullable=False))
    batch_id = cast(str, Column(UUID(as_uuid=True), nullable=True))
    location = cast(WKBElement, Column(Geometry("POINT", srid=4326), nullable=True))
    exif = cast(dict, Column(JSONB, nullable=True))
    uploaded_by = cast(
        str, Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    )
    uploaded_at = cast(datetime, Column(DateTime, default=timestamp, nullable=False))
    classified_at = cast(datetime, Column(DateTime, nullable=True))
    status = cast(
        ImageStatus,
        Column(Enum(ImageStatus), default=ImageStatus.UPLOADED, nullable=False),
    )
    rejection_reason = cast(str, Column(Text, nullable=True))
    sharpness_score = cast(float, Column(Float, nullable=True))
    duplicate_of = cast(
        str,
        Column(
            UUID(as_uuid=True),
            ForeignKey("project_images.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Relationships
    project = relationship(DbProject, backref="images")
    task = relationship(DbTask, backref="images")
    uploader = relationship(
        DbUser, foreign_keys=[uploaded_by], backref="uploaded_images"
    )

    __table_args__ = (
        Index("idx_project_images_project_id", "project_id"),
        Index("idx_project_images_task_id", "task_id"),
        Index("idx_project_images_status", "status"),
        Index("idx_project_images_batch_id", "batch_id"),
        Index("idx_project_images_hash_md5", "hash_md5"),
        Index("idx_project_images_uploaded_by", "uploaded_by"),
        Index("idx_project_images_location", location, postgresql_using="gist"),
        Index("idx_project_images_batch_status", "batch_id", "status"),
        {},
    )


class TaskEvent(Base):
    __tablename__ = "task_events"

    event_id = cast(str, Column(UUID(as_uuid=True), primary_key=True))
    project_id = cast(
        str, Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    )
    task_id = cast(
        str, Column(UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=False)
    )
    user_id = cast(str, Column(String(100), ForeignKey("users.id"), nullable=False))
    comment = cast(str, Column(String))

    state = cast(State, Column(Enum(State), nullable=False))
    created_at = cast(datetime, Column(DateTime, default=timestamp))

    __table_args__ = (
        Index("idx_task_event_composite", "task_id", "project_id"),
        Index("idx_task_event_project_id_user_id", "user_id", "project_id"),
    )
    updated_at = cast(datetime, Column(DateTime, nullable=True))


class Drone(Base):
    __tablename__ = "drones"

    id = cast(int, Column(Integer, primary_key=True, autoincrement=True))
    model = cast(str, Column(String, unique=True, nullable=False))
    manufacturer = cast(str, Column(String))
    camera_model = cast(str, Column(String))
    sensor_width = cast(float, Column(Float, nullable=True))
    sensor_height = cast(float, Column(Float, nullable=True))
    max_battery_health = cast(int, Column(Integer, nullable=True))
    focal_length = cast(float, Column(Float, nullable=True))
    image_width = cast(int, Column(Integer, nullable=True))
    image_height = cast(int, Column(Integer, nullable=True))
    max_altitude = cast(int, Column(Integer, nullable=True))
    max_speed = cast(float, Column(Float, nullable=True))
    weight = cast(int, Column(Integer, nullable=True))
    max_battery_health = cast(int, Column(Integer, nullable=True))
    created = cast(datetime, Column(DateTime, default=timestamp, nullable=False))


class DroneFlight(Base):
    __tablename__ = "drone_flights"

    flight_id = cast(str, Column(UUID(as_uuid=True), primary_key=True))
    drone_id = cast(int, Column(Integer, ForeignKey("drones.id"), nullable=False))
    task_id = cast(
        str, Column(UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=False)
    )
    user_id = cast(str, Column(String(100), ForeignKey("users.id"), nullable=False))
    flight_start = cast(datetime, Column(DateTime))
    flight_end = cast(datetime, Column(DateTime))
    user_estimated_battery_time_minutes = cast(int, Column(SmallInteger))
    override_camera_bearings = cast(list, Column(ARRAY(SmallInteger)))
    override_gimble_angles_degrees = cast(int, Column(ARRAY(SmallInteger)))
    override_height_from_ground_meters = cast(int, Column(SmallInteger))
    override_image_overlap_percent = cast(int, Column(SmallInteger))
    waypoint_file = cast(bytes, Column(LargeBinary))
    created_at = cast(datetime, Column(DateTime, default=timestamp))


class GroundControlPoint(Base):
    __tablename__ = "ground_control_points"

    id = cast(str, Column(UUID(as_uuid=True), primary_key=True))
    project_id = cast(
        str, Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    )
    image_relative_path = cast(str, Column(String))
    pixel_x = cast(int, Column(SmallInteger))
    pixel_y = cast(int, Column(SmallInteger))
    reference_point = cast(WKBElement, Column(Geometry("POLYGON", srid=4326)))
    created_at = cast(datetime, Column(DateTime, default=timestamp))


class DbUserProfile(Base):
    __tablename__ = "user_profile"
    user_id = cast(str, Column(String, ForeignKey("users.id"), primary_key=True))
    role = cast(list, Column(ARRAY(Enum(UserRole))))
    phone_number = cast(str, Column(String))
    country = cast(str, Column(String))
    city = cast(str, Column(String))

    # for project creator
    organization_name = cast(str, Column(String, nullable=True))
    organization_address = cast(str, Column(String, nullable=True))
    job_title = cast(str, Column(String, nullable=True))
    oam_api_token = cast(str, Column(String, nullable=True))

    notify_for_projects_within_km = cast(int, Column(SmallInteger, nullable=True))
    experience_years = cast(int, Column(SmallInteger, nullable=True))
    drone_you_own = cast(str, Column(String, nullable=True))
    certified_drone_operator = cast(bool, Column(Boolean, default=False))
    certificate_url = cast(str, Column(String, nullable=True))
    # drone registration certificate
    registration_certificate_url = cast(str, Column(String, nullable=True))


class DbDroneFlightHeight(Base):
    """Describes drone altitude regulations by country."""

    __tablename__ = "drone_flight_height"

    id = cast(int, Column(Integer, primary_key=True, autoincrement=True))
    country = cast(str, Column(String, nullable=False, unique=True))
    country_code = cast(
        str, Column(String(3), nullable=False)
    )  # ISO 3166-1 alpha-3 country code
    max_altitude_ft = cast(float, Column(Float, nullable=False))
    max_altitude_m = cast(float, Column(Float, nullable=False))
    created_at = cast(datetime, Column(DateTime, default=timestamp))
    updated_at = cast(datetime, Column(DateTime, nullable=True))
