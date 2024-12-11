import os
import io
import asyncio
import multiprocessing
from pathlib import Path

from fastapi import UploadFile
from scrapy.crawler import CrawlerProcess
from scrapy.utils.project import get_project_settings


from app.projects import project_logic
from app.jaxa.jaxa_coordinates import get_covering_tiles
from app.jaxa.tif_spider import TifSpider
from app.db import database

base_dir = Path(__file__).resolve().parent


def run_crawler_and_upload(coordinates_str: str, tif_file_path: str, project_id):
    """
    Runs the Scrapy crawler and uploads the DEM file to S3.
    """
    try:
        # Initialize and start the Scrapy crawler
        process = CrawlerProcess(get_project_settings())
        process.crawl(TifSpider, coordinates=coordinates_str)
        process.start()

        asyncio.run(upload_dem_file_s3_sync(tif_file_path, project_id))

    except Exception:
        pass


async def upload_dem_file_s3_sync(tif_file_path: str, project_id):
    """
    Synchronously uploads the DEM file to S3 and updates the database.
    """
    try:
        with open(tif_file_path, "rb") as dem_file:
            file_bytes = dem_file.read()
            file_obj = io.BytesIO(file_bytes)
            dem = UploadFile(file=file_obj, filename="dem.tif")

        dem_url = await project_logic.upload_file_to_s3(project_id, dem, "dem.tif")

        pool = await database.get_db_connection_pool()
        async with pool as pool_instance:
            async with pool_instance.connection() as conn:
                await project_logic.update_url(conn, project_id, dem_url)

        os.remove(tif_file_path)
    except Exception:
        pass


async def upload_dem_file(geometry, project_id):
    """
    Initiates the DEM file fetching and uploading process.
    """
    tiles = get_covering_tiles(geometry)
    tif_file_path = str(base_dir / "merged.tif")
    coordinates_str = ",".join(tiles)

    try:
        p = multiprocessing.Process(
            target=run_crawler_and_upload,
            args=(coordinates_str, tif_file_path, project_id),
        )
        p.start()

    except Exception:
        pass
