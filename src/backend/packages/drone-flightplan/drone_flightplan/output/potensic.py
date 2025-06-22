"""SQLite waypoint files used in Potensic Atom 1 & 2."""

import os
import logging
import sqlite3
from datetime import datetime, timezone

import geojson

log = logging.getLogger(__name__)


def create_tables(conn):
    cursor = conn.cursor()

    # Core system tables
    # NOTE these tables are present, but we aren't sure if they are used for anything,
    # so they are added just in case
    cursor.execute("CREATE TABLE IF NOT EXISTS android_metadata (locale TEXT)")
    cursor.execute(
        "CREATE TABLE IF NOT EXISTS table_schema (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type INTEGER)"
    )
    cursor.execute(
        "CREATE TABLE IF NOT EXISTS flightnotes (id INTEGER PRIMARY KEY AUTOINCREMENT, null_lpcolumn INTEGER, distance REAL, duration INTEGER, height REAL, speed REAL, starttime INTEGER)"
    )
    cursor.execute(
        "CREATE TABLE IF NOT EXISTS flightlog (id INTEGER PRIMARY KEY AUTOINCREMENT, null_lpcolumn INTEGER, isupload INTEGER, length INTEGER, name TEXT)"
    )
    cursor.execute(
        "CREATE TABLE IF NOT EXISTS uomuploadbody (id INTEGER PRIMARY KEY AUTOINCREMENT, altitude INTEGER, course INTEGER, flightenumname TEXT, flightsorties INTEGER, flightstatusenumname TEXT, gs INTEGER, height INTEGER, latitude INTEGER, longitude INTEGER, sn TEXT, timemillis INTEGER, vs INTEGER)"
    )
    cursor.execute(
        "CREATE TABLE IF NOT EXISTS uomrecord (id INTEGER PRIMARY KEY AUTOINCREMENT, sorties INTEGER, uomstatechangedtime INTEGER, uomstateenumname TEXT)"
    )

    # Insert default metadata
    cursor.execute("INSERT INTO android_metadata (locale) VALUES (?)", ("en_GB",))

    # Insert schema entries
    table_schema_entries = [
        (1, "flightrecordbean", 0),
        (2, "multipointbean", 0),
        (3, "flightnotes", 0),
        (4, "flightlog", 0),
        (5, "uomuploadbody", 0),
        (6, "uomrecord", 0),
    ]
    cursor.executemany(
        "INSERT INTO table_schema (id, name, type) VALUES (?, ?, ?)",
        table_schema_entries,
    )

    # Tables for waypoints
    # NOTE these two tables are key
    # - flightrecordbean has one entry per waypoint flight, however associated
    #   metadata appears to be purely information (not doing anything)
    # - multipointbean contains the coordinates of waypoints to fly to
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS flightrecordbean (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            duration INTEGER,
            height TEXT,
            mileage TEXT,
            num INTEGER,
            speed TEXT
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS multipointbean (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            flightrecordbean_id INTEGER,
            lat REAL,
            lng REAL
        )
    """)


def generate_potensic_sqlite(
    featcol: geojson.FeatureCollection, db_path: str = "map.db"
):
    """
    Generate SQLite DB in `db_path` with one flight record and many multipointbean entries.

    Args:
        waypoints (list): List of (lat, lon) tuples.
        db_path (str): Path to the SQLite file to create.
    """
    # Handle altitude & speed params (information only), else defaults
    first_geom = featcol.get("features", {})[0]
    altitude = round(first_geom.get("properties").get("altitude", 110))
    speed = round(first_geom.get("properties").get("speed", 4))

    waypoints: list[tuple[float, float]] = [
        feat.get("geometry").get("coordinates")[0:2]
        for feat in featcol.get("features", {})
    ]

    if os.path.exists(db_path):
        log.info(f"Deleting existing db at {db_path}")
        os.remove(db_path)

    conn = sqlite3.connect(db_path)
    create_tables(conn)
    cursor = conn.cursor()

    # Calculate metadata (placeholders for now)
    log.debug("Creating Potensic SQLite metadata")
    flight_id = 1
    duration = len(waypoints) * 5 * 1000  # 5000ms per point
    mileage = len(waypoints) * 10  # 10m per point
    date_str = datetime.now(tz=timezone.utc).strftime("%-d,%-m,%Y")

    # Insert into flightrecordbean
    cursor.execute(
        """
        INSERT INTO flightrecordbean(
          id,
          date,
          duration,
          height,
          mileage,
          num,
          speed
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """,
        (
            flight_id,
            date_str,
            duration,
            f"{altitude}m",
            f"{mileage}m",
            len(waypoints),
            f"{speed}km/h",
        ),
    )

    # Insert waypoints
    log.debug("Inserting Potensic SQLite waypoint data")
    # NOTE the input waypoints are geojson lon,lat format
    for i, (lon, lat) in enumerate(waypoints, start=1):
        cursor.execute(
            """
            INSERT INTO multipointbean(id, flightrecordbean_id, lat, lng)
            VALUES (?, ?, ?, ?)
        """,
            (i, flight_id, lat, lon),
        )

    conn.commit()
    conn.close()
    log.info(f"Database created at {db_path} with {len(waypoints)} waypoints.")
    return db_path


if __name__ == "__main__":
    sample_coords = [
        (-0.13512505592254342, 51.565597097346455),
        (-0.1351416738206126, 51.565631231208755),
        (-0.13507375720794812, 51.565631231208755),
        (-0.13501523329526322, 51.56561281688707),
        (-0.13503835387621166, 51.56557913214192),
        (-0.1350708671484142, 51.56560158864778),
    ]
    generate_potensic_sqlite(sample_coords, "map.db")
