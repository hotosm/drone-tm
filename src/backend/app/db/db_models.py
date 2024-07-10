from datetime import datetime
from typing import cast
from sqlalchemy import (
    Column,
    String,
    Integer,
    ForeignKey,
    DateTime,
    SmallInteger,
    Boolean,
    Float,
    Enum,
    Index,
    ARRAY,
    LargeBinary,
)
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base
from geoalchemy2 import Geometry, WKBElement
from app.models.enums import (
    TaskStatus,
    TaskSplitType,
    ProjectStatus,
    ProjectVisibility,
    UserRole,
    State,
)
from sqlalchemy.orm import (
    object_session,
    relationship,
)
from app.utils import timestamp


class DbUser(Base):
    __tablename__ = "users"

    id = cast(str, Column(String, primary_key=True))
    username = cast(str, Column(String, nullable=False, unique=True))
    password = cast(str, Column(String))
    is_active = cast(bool, Column(Boolean, default=False))
    is_superuser = cast(bool, Column(Boolean, default=False))
    profile_img = cast(str, Column(String, nullable=True))
    name = cast(str, Column(String))
    email_address = cast(str, Column(String, nullable=False, unique=True))
    role = cast(UserRole, Column(Enum(UserRole), default=UserRole.DRONE_PILOT))
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
    task_status = cast(TaskStatus, Column(Enum(TaskStatus), default=TaskStatus.READY))


class DbProject(Base):
    """Describes a Mapping Project."""

    __tablename__ = "projects"

    id = cast(str, Column(UUID(as_uuid=True), primary_key=True))
    name = cast(str, Column(String))
    short_description = cast(str, Column(String))
    description = cast(str, Column(String))
    per_task_instructions = cast(str, Column(String))
    created = cast(datetime, Column(DateTime, default=timestamp, nullable=False))
    last_updated = cast(datetime, Column(DateTime, default=timestamp))

    # GEOMETRY
    outline = cast(WKBElement, Column(Geometry("POLYGON", srid=4326)))
    centroid = cast(WKBElement, Column(Geometry("POINT", srid=4326)))
    no_fly_zones = cast(WKBElement, Column(Geometry("POLYGON", srid=4326)))

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
    overlap_percent = cast(float, Column(Float, nullable=True))
    gsd_cm_px = cast(float, Column(Float, nullable=True))  # in cm_px
    camera_bearings = cast(list[int], Column(ARRAY(SmallInteger), nullable=True))
    gimble_angles_degrees = cast(
        list, Column(ARRAY(SmallInteger), nullable=True)
    )  # degrees
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

    # PROJECT STATUS
    status = cast(
        ProjectStatus,
        Column(Enum(ProjectStatus), default=ProjectStatus.DRAFT, nullable=False),
    )
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
    phone_number = cast(str, Column(String))
    country = cast(str, Column(String))
    city = cast(str, Column(String))

    # for project creator
    organization_name = cast(str, Column(String, nullable=True))
    organization_address = cast(str, Column(String, nullable=True))
    job_title = cast(str, Column(String, nullable=True))

    notify_for_projects_within_km = cast(int, Column(SmallInteger, nullable=True))
    experience_years = cast(int, Column(SmallInteger, nullable=True))
    drone_you_own = cast(str, Column(String, nullable=True))
    certified_drone_operator = cast(bool, Column(Boolean, default=False))
    certificate = cast(bytes, Column(LargeBinary, nullable=True))
