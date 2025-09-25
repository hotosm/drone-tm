import base64
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.utils import formataddr
from pathlib import Path
from typing import Any, Dict, Optional, Union

import geojson
import requests
import shapely
from aiosmtplib import send as send_email
from fastapi import HTTPException
from geoalchemy2 import WKBElement
from geoalchemy2.shape import from_shape, to_shape
from geojson_pydantic import Feature, MultiPolygon, Polygon
from geojson_pydantic import FeatureCollection as FeatCol
from jinja2 import Template
from pyproj import Transformer
from shapely import wkb
from shapely.geometry import MultiPolygon as ShapelyMultiPolygon
from shapely.geometry import Point, mapping, shape
from shapely.ops import transform, unary_union

from app.config import settings

log = logging.getLogger(__name__)


def timestamp():
    """Get the current time.

    Used to insert a current timestamp into Pydantic models.
    """
    return datetime.now(timezone.utc)


def str_to_geojson(
    result: str, properties: Optional[dict] = None, id: Optional[str] = None
) -> Union[Feature, dict]:
    """Convert SQLAlchemy geometry to GeoJSON."""
    if result:
        wkb_data = bytes.fromhex(result)
        geom = wkb.loads(wkb_data)
        geojson = {
            "type": "Feature",
            "geometry": mapping(geom),
            "properties": properties,
            "id": id,
        }
        return Feature(**geojson)
    return {}


def geometry_to_geojson(
    geometry: WKBElement, properties: Optional[dict] = None, id: Optional[int] = None
) -> Union[Feature, dict]:
    """Convert SQLAlchemy geometry to GeoJSON."""
    if geometry:
        shape = to_shape(geometry)
        geojson = {
            "type": "Feature",
            "geometry": mapping(shape),
            "properties": properties,
            "id": id,
            # "bbox": shape.bounds,
        }
        return Feature(**geojson)
    return {}


def geojson_to_geometry(
    geojson: Union[FeatCol, Feature, MultiPolygon, Polygon],
) -> Optional[WKBElement]:
    """Convert GeoJSON to SQLAlchemy geometry."""
    parsed_geojson = geojson
    if isinstance(geojson, (FeatCol, Feature, MultiPolygon, Polygon)):
        parsed_geojson = parse_and_filter_geojson(
            geojson.model_dump_json(), filter=False
        )

    if not parsed_geojson:
        return None

    features = parsed_geojson.get("features", [])

    if len(features) > 1:
        geometries = [shape(feature.get("geometry")) for feature in features]
        merged_geometry = unary_union(geometries)
        if not isinstance(merged_geometry, ShapelyMultiPolygon):
            merged_geometry = ShapelyMultiPolygon([merged_geometry])
        shapely_geom = merged_geometry
    else:
        geometry = features[0].get("geometry")

        shapely_geom = shape(geometry)

    return from_shape(shapely_geom)


def parse_and_filter_geojson(
    geojson_raw: Union[str, bytes], filter: bool = True
) -> Optional[geojson.FeatureCollection]:
    """Parse geojson string and filter out incompatible geometries."""
    geojson_parsed = geojson.loads(geojson_raw)

    if isinstance(geojson_parsed, geojson.FeatureCollection):
        log.debug("Already in FeatureCollection format, skipping reparse")
        featcol = geojson_parsed
    elif isinstance(geojson_parsed, geojson.Feature):
        log.debug("Converting Feature to FeatureCollection")
        featcol = geojson.FeatureCollection(features=[geojson_parsed])
    else:
        log.debug("Converting Geometry to FeatureCollection")
        featcol = geojson.FeatureCollection(
            features=[geojson.Feature(geometry=geojson_parsed)]
        )

    # Exit early if no geoms
    if not (features := featcol.get("features", [])):
        return None

    # Strip out GeometryCollection wrappers
    for feat in features:
        geom = feat.get("geometry")
        if (
            geom.get("type") == "GeometryCollection"
            and len(geom.get("geometries")) == 1
        ):
            feat["geometry"] = geom.get("geometries")[0]

    # Return unfiltered featcol
    if not filter:
        return featcol

    # Filter out geoms not matching main type
    geom_type = get_featcol_main_geom_type(featcol)
    features_filtered = [
        feature
        for feature in features
        if feature.get("geometry", {}).get("type", "") == geom_type
    ]

    return geojson.FeatureCollection(features_filtered)


def get_featcol_main_geom_type(featcol: geojson.FeatureCollection) -> str:
    """Get the predominant geometry type in a FeatureCollection."""
    geometry_counts = {"Polygon": 0, "Point": 0, "Polyline": 0}

    for feature in featcol.get("features", []):
        geometry_type = feature.get("geometry", {}).get("type", "")
        if geometry_type in geometry_counts:
            geometry_counts[geometry_type] += 1

    return max(geometry_counts, key=geometry_counts.get)


def read_wkb(wkb: WKBElement):
    """Load a WKBElement and return a shapely geometry."""
    return to_shape(wkb)


def write_wkb(shape):
    """Load shapely geometry and output WKBElement."""
    return from_shape(shape)


def merge_multipolygon(features: Union[Feature, FeatCol, MultiPolygon, Polygon]):
    """Merge multiple Polygons or MultiPolygons into a single Polygon.

    Args:
        features: geojson features to merge.

    Returns:
        A GeoJSON FeatureCollection containing the merged Polygon.
    """
    try:

        def remove_z_dimension(coord):
            """Remove z dimension from geojson."""
            return coord.pop() if len(coord) == 3 else None

        features = parse_featcol(features)

        multi_polygons = []
        # handles both collection or single feature
        features = features.get("features", [features])

        for feature in features:
            list(map(remove_z_dimension, feature["geometry"]["coordinates"][0]))
            polygon = shapely.geometry.shape(feature["geometry"])
            multi_polygons.append(polygon)

        merged_polygon = unary_union(multi_polygons)
        if isinstance(merged_polygon, MultiPolygon):
            merged_polygon = merged_polygon.convex_hull

        merged_geojson = mapping(merged_polygon)
        if merged_geojson["type"] == "MultiPolygon":
            log.error(
                "Resulted GeoJSON contains disjoint Polygons. "
                "Adjacent polygons are preferred."
            )
        return geojson.FeatureCollection([geojson.Feature(geometry=merged_geojson)])
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Couldn't merge the multipolygon to polygon: {str(e)}",
        ) from e


def parse_featcol(features: Union[Feature, FeatCol, MultiPolygon, Polygon]):
    """Parse a feature collection or feature into a GeoJSON FeatureCollection.

    Args:
        features: Feature, FeatCol, MultiPolygon, Polygon or dict.

    Returns:
        dict: Parsed GeoJSON FeatureCollection.
    """
    if isinstance(features, dict):
        return features

    feat_col = features.model_dump_json()
    feat_col = geojson.loads(feat_col)
    if isinstance(features, (Polygon, MultiPolygon)):
        feat_col = geojson.FeatureCollection([geojson.Feature(geometry=feat_col)])
    elif isinstance(features, Feature):
        feat_col = geojson.FeatureCollection([feat_col])
    return feat_col


def get_address_from_lat_lon(latitude, longitude):
    """Get address using Nominatim, using lat,lon."""
    base_url = "https://nominatim.openstreetmap.org/reverse"

    params = {
        "format": "json",
        "lat": latitude,
        "lon": longitude,
        "zoom": 18,
    }
    headers = {"Accept-Language": "en"}  # Set the language to English

    log.debug("Getting Nominatim address from project centroid")
    response = requests.get(base_url, params=params, headers=headers)
    if (status_code := response.status_code) != 200:
        log.error(f"Getting address string failed: {status_code}")
        return None

    data = response.json()
    log.debug(f"Nominatim response: {data}")

    address = data.get("address", None)
    if not address:
        log.error(f"Getting address string failed: {status_code}")
        return None

    country = address.get("country", "")
    city = address.get("city", "")
    state = address.get("state", "")

    address_str = f"{city},{country}" if city else f"{state},{country}"

    if not address_str or address_str == ",":
        log.error("Getting address string failed")
        return None

    return address_str


def multipolygon_to_polygon(features: Union[Feature, FeatCol, MultiPolygon, Polygon]):
    """Converts a GeoJSON FeatureCollection of MultiPolygons to Polygons.

    Args:
        features : A GeoJSON FeatureCollection containing MultiPolygons/Polygons.

    Returns:
        geojson.FeatureCollection: A GeoJSON FeatureCollection containing Polygons.
    """
    geojson_feature = []
    features = parse_featcol(features)

    # handles both collection or single feature
    features = features.get("features", [features])

    for feature in features:
        properties = feature["properties"]
        geom = shape(feature["geometry"])
        if geom.geom_type == "Polygon":
            geojson_feature.append(
                geojson.Feature(geometry=geom, properties=properties)
            )
        elif geom.geom_type == "MultiPolygon":
            geojson_feature.extend(
                geojson.Feature(geometry=polygon_coords, properties=properties)
                for polygon_coords in geom.geoms
            )

    return geojson.FeatureCollection(geojson_feature)


def normalise_featcol(featcol: geojson.FeatureCollection) -> geojson.FeatureCollection:
    """Normalise a FeatureCollection into a standadised format.

    The final FeatureCollection will only contain:
    - Polygon
    - Polyline
    - Point

    Processed:
    - MultiPolygons will be divided out into individual polygons.
    - GeometryCollections wrappers will be stripped out.
    - Removes any z-dimension coordinates, e.g. [43, 32, 0.0]

    Args:
        featcol: A parsed FeatureCollection.

    Returns:
        geojson.FeatureCollection: A normalised FeatureCollection.
    """
    for feat in featcol.get("features", []):
        geom = feat.get("geometry")

        # Strip out GeometryCollection wrappers
        if (
            geom.get("type") == "GeometryCollection"
            and len(geom.get("geometries", [])) == 1
        ):
            feat["geometry"] = geom.get("geometries")[0]

        # Remove any z-dimension coordinates
        coords = geom.get("coordinates")
        if isinstance(coords, list) and len(coords) == 3:
            coords.pop()

    # Convert MultiPolygon type --> individual Polygons
    return multipolygon_to_polygon(featcol)


def geojson_to_featcol(geojson_obj: dict) -> geojson.FeatureCollection:
    """Enforce GeoJSON is wrapped in FeatureCollection.

    The type check is done directly from the GeoJSON to allow parsing
    from different upstream libraries (e.g. geojson_pydantic).
    """
    # We do a dumps/loads cycle to strip any extra obj logic
    geojson_type = json.loads(json.dumps(geojson_obj)).get("type")

    if geojson_type == "FeatureCollection":
        log.debug("Already in FeatureCollection format, reparsing")
        features = geojson_obj.get("features")
    elif geojson_type == "Feature":
        log.debug("Converting Feature to FeatureCollection")
        features = [geojson_obj]
    else:
        log.debug("Converting Geometry to FeatureCollection")
        features = [geojson.Feature(geometry=geojson_obj)]

    featcol = geojson.FeatureCollection(features=features)

    return normalise_featcol(featcol)


@dataclass
class EmailData:
    html_content: str
    subject: str


def render_email_template(
    folder_name: str, template_name: str, context: dict[str, Any]
) -> str:
    """Render an email template with the given context from the specified folder.

    Args:
        folder_name (str): The folder containing the template file.
        template_name (str): The name of the template file to be rendered.
        context (dict[str, Any]): A dictionary containing the context variables to be used in the template.

    Returns:
        str: The rendered HTML content of the email template.
    """
    template_path = (
        Path(__file__).parent / "email_templates" / folder_name / template_name
    )
    template_str = template_path.read_text()
    html_content = Template(template_str).render(context)
    return html_content


async def send_notification_email(email_to, subject, html_content):
    """Send an email with the given subject and HTML content to the specified recipient.

    Args:
        email_to (str): The recipient's email address.
        subject (str, optional): The subject of the email. Defaults to an empty string.
        html_content (str, optional): The HTML content of the email. Defaults to an empty string.

    Raises:
        AssertionError: If email configuration is not provided or emails are disabled.

    Example:
        send_email(
            email_to="recipient@example.com",
            subject="Hello World",
            html_content="<h1>Hello, this is a test email.</h1>"
        )
    """
    assert settings.emails_enabled, "no provided configuration for email variables"

    message = MIMEText(html_content, "html")
    message["Subject"] = subject
    message["From"] = formataddr(
        (settings.EMAILS_FROM_NAME, settings.EMAILS_FROM_EMAIL)
    )
    message["To"] = email_to
    try:
        log.debug("Sending email message")
        await send_email(
            message,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=settings.SMTP_PASSWORD,
        )
    except Exception as e:
        log.error(f"Error sending email: {e}")


def test_email(email_to: str, subject: str = "Test email") -> None:
    html_content = render_email_template(
        folder_name="mapping",
        template_name="email_template.html",
        context={"project_name": settings.APP_NAME, "email": email_to},
    )

    send_notification_email(
        email_to=email_to, subject=subject, html_content=html_content
    )


async def send_reset_password_email(email: str, token: str):
    reset_link = f"{settings.FRONTEND_URL}/reset-password?token={token}"

    context = {
        "reset_link": reset_link,
        "project_name": settings.EMAILS_FROM_NAME,
        "email": email,
    }

    html_content = render_email_template("password", "password_reset.html", context)

    message = MIMEText(html_content, "html")
    message["From"] = formataddr(
        (settings.EMAILS_FROM_NAME, settings.EMAILS_FROM_EMAIL)
    )
    message["To"] = email
    message["Subject"] = "Password Reset Request"

    try:
        log.debug("Sending email message")
        await send_email(
            message,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=settings.SMTP_PASSWORD,
        )
    except Exception as e:
        log.error(f"Error sending email: {e}")


def geojson_to_kml(geojson_data: dict) -> str:
    """Converts GeoJSON data to KML format.

    Args:
        geojson_data (dict): GeoJSON data as a dictionary.

    Returns:
        str: KML formatted string.
    """
    kml_output = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2">',
        "<Document>",
    ]

    # Iterate through each feature in the GeoJSON
    for feature in geojson_data.get("features", []):
        geometry_type = feature["geometry"]["type"]
        coordinates = feature["geometry"]["coordinates"]

        # Create a KML Placemark for each feature
        kml_output.append("<Placemark>")

        # Add properties as name or description if available
        if "properties" in feature and feature["properties"]:
            if "name" in feature["properties"]:
                kml_output.append(f"<name>{feature['properties']['name']}</name>")
            if "description" in feature["properties"]:
                kml_output.append(
                    f"<description>{feature['properties']['description']}</description>"
                )

        # Handle different geometry types (Point, LineString, Polygon)
        if geometry_type == "Point":
            lon, lat = coordinates
            kml_output.append(f"<Point><coordinates>{lon},{lat}</coordinates></Point>")
        elif geometry_type == "LineString":
            coord_string = " ".join([f"{lon},{lat}" for lon, lat in coordinates])
            kml_output.append(
                f"<LineString><coordinates>{coord_string}</coordinates></LineString>"
            )
        elif geometry_type == "Polygon":
            for polygon in coordinates:
                coord_string = " ".join([f"{lon},{lat}" for lon, lat in polygon])
                kml_output.append(
                    f"<Polygon><outerBoundaryIs><LinearRing><coordinates>{coord_string}</coordinates></LinearRing></outerBoundaryIs></Polygon>"
                )

        kml_output.append("</Placemark>")

    kml_output.append("</Document>")
    kml_output.append("</kml>")

    return "\n".join(kml_output)


async def send_project_approval_email_to_regulator(
    emails: list, project_id: str, creator_name: str, project_name: str
):
    for email in emails:
        encoded_email = base64.urlsafe_b64encode(email.encode()).decode()
        project_link = f"{settings.FRONTEND_URL}/projects/{project_id}/approval/?token={encoded_email}"
        context = {
            "project_link": project_link,
            "project_name": project_name,
            "creator_name": creator_name,
        }

        html_content = render_email_template(
            "regulator", "approval_request.html", context
        )

        await send_notification_email(
            email_to=email,
            subject="Project Review Request for Drone Operations Approval",
            html_content=html_content,
        )


def calculate_flight_time_from_placemarks(placemarks: Dict) -> Dict:
    """Calculate the total and average flight time and total flight distance based on placemarks.

    Args:
        placemarks (Dict): GeoJSON-like data structure with flight plan.

    Returns:
        Dict: Contains formatted total flight time, segment times, and total distance.
    """
    total_time = 0
    total_distance = 0
    features = placemarks["features"]
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)

    for i in range(1, len(features)):
        # Extract current and previous coordinates
        prev_coords = features[i - 1]["geometry"]["coordinates"][:2]
        curr_coords = features[i]["geometry"]["coordinates"][:2]
        speed = features[i]["properties"]["speed"]  # Speed in m/s

        # Create Shapely Points and transform to planar coordinates for distance calculation
        prev_point = Point(transform(transformer.transform, Point(prev_coords)))
        curr_point = Point(transform(transformer.transform, Point(curr_coords)))

        # Calculate distance (meters) and time (seconds)
        distance = prev_point.distance(curr_point)
        total_distance += distance  # Accumulate total distance
        segment_time = distance / speed
        total_time += segment_time

    flight_distance_km = total_distance / 1000  # Convert to kilometers
    flight_time_minutes = total_time / 60  # Convert to minutes

    return {
        "total_flight_time": f"{flight_time_minutes:.2f}",
        "total_flight_time_seconds": round(total_time, 2),
        "flight_distance_km": round(flight_distance_km, 2),
    }
