import os
import io

from fastapi import UploadFile, BackgroundTasks
from pathlib import Path
from psycopg import Connection


from scrapy.crawler import CrawlerProcess
from scrapy.utils.project import get_project_settings

from app.projects import project_logic
from app.jaxa.jaxa_coordinates import get_covering_tiles
from app.jaxa.tif_spider import TifSpider


base_dir = Path(__file__).resolve().parent


def upload_dem_file(
    db: Connection, geometry, project_id, background_tasks: BackgroundTasks
):
    """
    Fetch the dem file from the scrapy and pass it to store in the db in background

    Args:
        db (Connection): _description_
        geometry (_type_): _description_
        project_id (_type_): _description_
        background_tasks (BackgroundTasks): _description_
    """

    tiles = get_covering_tiles(geometry)
    tif_file_path = str(base_dir / "merged.tif")

    coordinates_str = ",".join(tiles)
    process = CrawlerProcess(get_project_settings())

    crawler = process.create_crawler(TifSpider)

    process.crawl(crawler, coordinates=coordinates_str)

    try:
        process.start()
        ## store the file in db
        background_tasks.add_task(upload_dem_file_s3, db, tif_file_path, project_id)
    except Exception as e:
        print(f"Scrapy execution failed: {str(e)}")


async def upload_dem_file_s3(db: Connection, tif_file_path, project_id):
    """
    Upload the dem file in the db

    Args:
        db (Connection): _description_
        tif_file_path (_type_): _description_
        project_id (_type_): _description_
    """
    with open(tif_file_path, "rb") as dem_file:
        file_bytes = dem_file.read()
        file_obj = io.BytesIO(file_bytes)  # Create an in-memory file-like object
        dem = UploadFile(file=file_obj, filename="dem.tif")

    dem_url = await project_logic.upload_file_to_s3(project_id, dem, "dem.tif")

    await project_logic.update_url(db, project_id, dem_url)
    os.remove(tif_file_path)
