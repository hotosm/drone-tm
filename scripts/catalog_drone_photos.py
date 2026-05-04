#!/usr/bin/env python3

"""
Generates a CSV catalog of the drone photos in a directory or an S3 bucket,
including file metadata and useful GIS data from EXIF and XMP tags:
  - Timestamp (when captured)
  - Filename
  - Path (file path or S3 object key)
  - File size (bytes)
  - GPS latitude
  - GPS longitude
  - Absolute altitude
  - Relative altitude
  - Camera gimbal pitch (degrees above horizon)
  - Camera gimbal yaw (degrees CCW from north)
  - Flight yaw (degrees CCW from north)
  - Flight horizontal speed (m/s)
  - Flight vertical speed (m/s)

The EXIF and XMP tags are obtained by looking at just the first 64 KiB of each
image file, to avoid downloading the entire file from S3.

Only .jpg and .jpeg files are scanned.

Usage:
    python3 catalog_drone_photos.py PATH
    python3 catalog_drone_photos.py s3://BUCKET_NAME
    python3 catalog_drone_photos.py s3://BUCKET_NAME/PREFIX

Requirements:
    pip3 install boto3 exifread
"""

import argparse
import boto3
import csv
import exifread
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from io import BytesIO
import os
import re
import sys

HEAD_BYTES = 65536
FILE_EXTENSIONS = ['.jpg', '.jpeg']


def list_jpegs_in_dir(path):
    """Yields (path, size) for each JPEG file under the given path."""
    for dirpath, dirnames, filenames in os.walk(path):
        for filename in filenames:
            base, ext = os.path.splitext(filename)
            if ext.lower() in FILE_EXTENSIONS:
                filepath = os.path.join(dirpath, filename)
                yield filepath, os.path.getsize(filepath)


def list_jpegs_in_s3(s3_url):
    """Yields (s3_url, size) for each JPEG under the given S3 URL."""
    assert s3_url.startswith('s3://')
    bucket, prefix = (s3_url[5:].split('/', 1) + [''])[:2]
    s3 = boto3.client('s3')
    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get('Contents', []):
            base, ext = os.path.splitext(obj['Key'])
            if ext.lower() in FILE_EXTENSIONS:
                yield f"s3://{bucket}/{obj['Key']}", obj['Size']


def to_decimal_degrees(deg, min, sec, compass_direction):
    """Converts degrees/minutes/seconds to decimal degrees."""
    try:
        deg = float(deg)
        min = float(min)
        sec = float(sec)
    except ValueError:
        return None
    decimal = round(deg + min/60.0 + sec/3600.0, 6)
    return -decimal if str(compass_direction) in 'SW' else decimal


def get_gps_datetime(exif_tags):
    """Formats the GPS date and time as an ISO datetime."""
    date_tag = exif_tags.get('GPS GPSDate') or exif_tags.get('GPS GPSDateStamp')
    time_tag = exif_tags.get('GPS GPSTimeStamp')
    if date_tag and time_tag:
        date_part = str(date_tag).strip().replace(':', '-')  # YYYY-MM-DD
        try:
            [h, m, s] = [int(float(x)) for x in time_tag.values[:3]]
        except ValueError:
            return None
        return '%sT%02d:%02d:%02d' % (date_part, h, m, s)


def get_exif_datetime(exif_tags, tag_name):
    """Formats an EXIF datetime tag as an ISO datetime."""
    try:
        tag_value = str(exif_tags.get(tag_name))
        dt = datetime.strptime(tag_value, '%Y:%m:%d %H:%M:%S')
        return dt.isoformat()
    except:
        return None


def get_metadata(head_bytes):
    """Gets the EXIF and XMP data from a block of initial bytes of a file.

    Returns a dictionary of metadata fields.  Also synthesizes "Timestamp",
    "Latitude", "Longitude", and "FlightXYSpeed" fields from other fields."""
    tags = exifread.process_file(BytesIO(head_bytes), details=False)
    if not tags:
        return {}
    try:
        start = head_bytes.index(b'<x:xmpmeta')
        end = head_bytes.index(b'</x:xmpmeta')
        xmp = head_bytes[start:end].decode('latin1')
    except:
        return {}

    exif_data = {name: str(tags.get(name)) for name in tags}
    xmp_data = {k: v for k, v in re.findall(r'drone-dji:(\w+)="(.*)?"', xmp)}
    metadata = dict(**exif_data, **xmp_data)

    metadata['Timestamp'] = (
        get_gps_datetime(tags) or
        get_exif_datetime(tags, 'EXIF DateTimeOriginal') or
        get_exif_datetime(tags, 'Image DateTime')
    )

    lat = tags.get('GPS GPSLatitude')
    lat_ref = tags.get('GPS GPSLatitudeRef')
    lon = tags.get('GPS GPSLongitude')
    lon_ref = tags.get('GPS GPSLongitudeRef')
    if lat and lat_ref and lon and lon_ref:
        metadata['Latitude'] = to_decimal_degrees(*lat.values, lat_ref)
        metadata['Longitude'] = to_decimal_degrees(*lon.values, lon_ref)

    x_speed = metadata.get('FlightXSpeed')
    y_speed = metadata.get('FlightYSpeed')
    if x_speed and y_speed:
        try:
            speed = (float(x_speed)**2 + float(y_speed)**2)**0.5
            metadata['FlightXYSpeed'] = '%.2f' % speed
        except ValueError:
            pass

    return metadata


def get_s3_head_bytes(s3, s3_url, num_bytes):
    """Returns the first num_bytes bytes of a file in S3."""
    assert s3_url.startswith('s3://')
    bucket, key = (s3_url[5:].split('/', 1) + [''])[:2]
    range = 'bytes=0-%d' % (num_bytes - 1)
    response = s3.get_object(Bucket=bucket, Key=key, Range=range)
    return response['Body'].read()


def get_s3_metadata(s3, s3_url, size):
    """Gets the metadata from a file in S3."""
    metadata = {}
    try:
        if size == 0:
            raise ValueError('File is empty')
        head_bytes = min(size, HEAD_BYTES)
        metadata = get_metadata(get_s3_head_bytes(s3, s3_url, head_bytes))
        if not metadata:
            head_bytes = min(size, HEAD_BYTES*2)
            metadata = get_metadata(get_s3_head_bytes(s3, s3_url, head_bytes))
    except Exception as e:
        metadata['Error'] = f'{type(e).__name__}: {e}'
    bucket, key = (s3_url[5:].split('/', 1) + [''])[:2]
    metadata['Path'] = key
    metadata['Bytes'] = size
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)

    parser.add_argument('location', help='pathname or S3 bucket URL')
    parser.add_argument('--output', '-o', default='catalog.csv', help=
        'output CSV path (default: catalog.csv)')
    parser.add_argument('--workers', '-w', type=int, default=100, help=
        'number of download threads (default: 100)')
    args = parser.parse_args()
    results = []
    errors = 0

    if os.path.exists(args.output):
        sys.stderr.write('Overwrite %s? ' % args.output)
        sys.stderr.flush()
        if sys.stdin.readline().strip().lower() not in ['y', 'yes']:
            raise SystemExit(1)

    if args.location.startswith('s3://'):
        sys.stderr.write('Listing JPEG files in %s:\n' % args.location)
        items = []
        for item in list_jpegs_in_s3(args.location):
            items.append(item)
            if len(items) % 10000 == 0:
                sys.stderr.write('  %d...\n' % len(items))
        sys.stderr.write('%d found.  Extracting metadata:\n' % len(items))

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            s3 = boto3.client('s3')
            futures = {
                pool.submit(get_s3_metadata, s3, s3_url, size): s3_url
                for s3_url, size in items
            }
            for i, future in enumerate(as_completed(futures), 1):
                metadata = future.result()
                if 'Error' in metadata:
                    errors += 1
                    sys.stderr.write('Error (%s): %s\n' %
                        (metadata['Path'], metadata['Error']))
                results.append(metadata)
                if i % 1000 == 0 and i < len(items):
                    sys.stderr.write('  %d... (errors: %d)\n' % (i, errors))
            sys.stderr.write('%d scanned (errors: %d).\n' % (len(items), errors))

    else:
        items = list_jpegs_in_dir(args.location)
        for path, size in items:
            metadata = get_metadata(open(path, 'rb').read(HEAD_BYTES))
            if not metadata:
                metadata = get_metadata(open(path, 'rb').read(HEAD_BYTES*2))
            if not metadata:
                metadata = get_metadata(open(path, 'rb').read())
            metadata['Path'] = path
            metadata['Bytes'] = size
            results.append(metadata)

    keys = [
        'Timestamp', 'Filename', 'Path', 'Bytes', 'Latitude', 'Longitude',
        'AbsoluteAltitude', 'RelativeAltitude',
        'GimbalPitchDegree', 'GimbalYawDegree', 'FlightYawDegree',
        'FlightXYSpeed', 'FlightZSpeed'
    ]
    with open(args.output, 'w') as file:
        writer = csv.writer(file)
        writer.writerow(keys)
        for result in results:
            result['Filename'] = result['Path'].split('/')[-1]
            writer.writerow([result.get(key) for key in keys])
        sys.stderr.write('%s: Wrote %d row%s.\n' %
            (args.output, len(results), 's' if len(results) != 1 else ''))


if __name__ == '__main__':
    main()
