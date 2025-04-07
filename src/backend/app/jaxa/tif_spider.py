import io
import os
import zipfile
from pathlib import Path

import scrapy
from osgeo import gdal

from app.config import settings

base_dir = Path(__file__).resolve().parent


class TifSpider(scrapy.Spider):
    name = "tif_spider"
    allowed_domains = ["eorc.jaxa.jp"]
    merged_file_path = None

    def __init__(self, coordinates, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.tif_files = []
        self.coordinates = coordinates.split(",")

    headers = {
        "authority": "www.eorc.jaxa.jp",
        "path": "/ALOS/en/aw3d30/data/html_v2404/xml/{caption}_5_5.xml",
        "method": "GET",
        "accept": "application/xml, text/xml, */*; q=0.01",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "en-US,en;q=0.9",
        "authorization": f"Basic {settings.JAXA_AUTH_TOKEN}",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "sec-ch-ua": '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Linux"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "x-requested-with": "XMLHttpRequest",
    }

    def start_requests(self):
        urls = []
        for coordinate in self.coordinates:
            coords = coordinate.split("_")
            five_by_five, one_by_one = coords[0], coords[1]
            urls.append(
                f"https://www.eorc.jaxa.jp/ALOS/aw3d30/data/release_v2404/{five_by_five}/{one_by_one}.zip",
            )

        for url in urls:
            yield scrapy.Request(url=url, callback=self.parse)

    def parse(self, response):
        temp_dir = os.path.join(os.getcwd(), "temp")
        os.makedirs(temp_dir, exist_ok=True)
        try:
            with zipfile.ZipFile(io.BytesIO(response.body)) as zip_file:
                for file_name in zip_file.namelist():
                    if file_name.endswith("DSM.tif"):
                        # Save .tif file into the temp directory
                        temp_path = os.path.join(temp_dir, os.path.basename(file_name))
                        with zip_file.open(file_name) as tif_file:
                            with open(temp_path, "wb") as out_file:
                                out_file.write(tif_file.read())
                        self.tif_files.append(temp_path)
        except Exception:
            pass

    def closed(self, reason):
        if self.tif_files:
            self.merged_file_path = self.merge_tiles()

    def merge_tiles(self):
        vrt_file = "merged.vrt"
        gdal.BuildVRT(vrt_file, self.tif_files)
        output_file = str(base_dir / "merged.tif")

        gdal.Translate(output_file, vrt_file)
        for file in self.tif_files:
            os.remove(file)
        os.remove(vrt_file)
        return output_file
