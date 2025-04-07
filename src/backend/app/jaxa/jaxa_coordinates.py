import math

from shapely.geometry import Polygon, box


def parse_polygon(coordinates):
    """Parses the input coordinates into a Shapely Polygon object."""
    return Polygon(coordinates)


def get_bounding_box(polygon):
    """Returns the bounding box of the polygon as (min_lon, min_lat, max_lon, max_lat)."""
    min_lon, min_lat, max_lon, max_lat = polygon.bounds
    return min_lon, min_lat, max_lon, max_lat


def get_5x5_tiles(min_lon, min_lat, max_lon, max_lat):
    """Calculates all 5°×5° tiles that intersect with the bounding box.
    Returns a list of tuples representing the lower-left corner of each tile.
    """
    tiles = []

    # Define the origin for 5x5 tiles
    origin_lon = -180
    origin_lat = -90

    # Calculate the starting and ending indices for longitude and latitude
    start_lon_idx = math.floor((min_lon - origin_lon) / 5)
    end_lon_idx = math.floor((max_lon - origin_lon) / 5)
    start_lat_idx = math.floor((min_lat - origin_lat) / 5)
    end_lat_idx = math.floor((max_lat - origin_lat) / 5)

    for lon_idx in range(start_lon_idx, end_lon_idx + 1):
        for lat_idx in range(start_lat_idx, end_lat_idx + 1):
            tile_lon = origin_lon + lon_idx * 5
            tile_lat = origin_lat + lat_idx * 5
            tiles.append((tile_lon, tile_lat))

    return tiles


def get_1x1_tiles_within_5x5(tile_lon, tile_lat, polygon):
    """For a given 5°×5° tile, calculates all 1°×1° tiles that intersect with the polygon.
    Returns a list of tuples representing the lower-left corner of each 1x1 tile.
    """
    tiles = []

    for lon in range(int(tile_lon), int(tile_lon + 5)):
        for lat in range(int(tile_lat), int(tile_lat + 5)):
            tile_polygon = box(lon, lat, lon + 1, lat + 1)
            if polygon.intersects(tile_polygon):
                tiles.append((lon, lat))

    return tiles


def format_tile_name(tile5_lon, tile5_lat, tile1_lon, tile1_lat):
    """Formats the tile name based on the naming convention:
    N015W075_N019W071
    """
    # Format 5x5 tile part
    lat_5 = f"{abs(tile5_lat):03d}"
    lat_dir_5 = "N" if tile5_lat >= 0 else "S"
    lon_5 = f"{abs(tile5_lon):03d}"
    lon_dir_5 = "E" if tile5_lon >= 0 else "W"
    tile5 = f"{lat_dir_5}{lat_5}{lon_dir_5}{lon_5}"

    # Format 1x1 tile part
    lat_1 = f"{abs(tile1_lat):03d}"
    lat_dir_1 = "N" if tile1_lat >= 0 else "S"
    lon_1 = f"{abs(tile1_lon):03d}"
    lon_dir_1 = "E" if tile1_lon >= 0 else "W"
    tile1 = f"{lat_dir_1}{lat_1}{lon_dir_1}{lon_1}"

    return f"{tile5}_{tile1}"


def get_covering_tiles(polygon_geojson):
    """Main function to get the list of tile names covering the polygon."""
    # Parse the GeoJSON polygon
    polygon = parse_polygon(polygon_geojson["coordinates"][0])

    # Get bounding box
    min_lon, min_lat, max_lon, max_lat = get_bounding_box(polygon)

    # Get all relevant 5x5 tiles
    tiles_5x5 = get_5x5_tiles(min_lon, min_lat, max_lon, max_lat)

    # Initialize a set to avoid duplicates
    tile_names = set()

    # Iterate through each 5x5 tile and find intersecting 1x1 tiles
    for tile5_lon, tile5_lat in tiles_5x5:
        tiles_1x1 = get_1x1_tiles_within_5x5(tile5_lon, tile5_lat, polygon)
        for tile1_lon, tile1_lat in tiles_1x1:
            name = format_tile_name(tile5_lon, tile5_lat, tile1_lon, tile1_lat)
            tile_names.add(name)

    return sorted(tile_names)
