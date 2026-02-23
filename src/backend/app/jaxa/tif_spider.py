import io
import os
import zipfile
from pathlib import Path

import scrapy
from osgeo import gdal


base_dir = Path(__file__).resolve().parent


class TifSpider(scrapy.Spider):
    name = "tif_spider"
    allowed_domains = ["www.eorc.jaxa.jp", "eorc.jaxa.jp"]
    # Disable dupe filter so CrawlerRunner reuse across jobs doesn't silently
    # drop URLs that were crawled in a previous job in the same process.
    custom_settings = {
        "DUPEFILTER_CLASS": "scrapy.dupefilters.BaseDupeFilter",
    }

    def __init__(self, coordinates, output_path, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.tif_files = []
        self.coordinates = coordinates.split(",")
        self.output_path = output_path
        # Use project-specific temp directory based on output path
        self.temp_dir = Path(output_path).parent / "tiles"
        self.temp_dir.mkdir(parents=True, exist_ok=True)

    headers = {
        "authority": "www.eorc.jaxa.jp",
        "path": "/ALOS/en/aw3d30/data/html_v2404/xml/{caption}_5_5.xml",
        "method": "GET",
        "accept": "application/xml, text/xml, */*; q=0.01",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "en-US,en;q=0.9",
        # NOTE we don't seem to need auth for JAXA (perhaps we don't reach download caps)
        # "authorization": f"Basic {settings.JAXA_AUTH_TOKEN}",
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
            if len(coords) < 2:
                self.logger.error(
                    f"Invalid coordinate format '{coordinate}', expected 'FIVE_ONE' (e.g. N035W005_N036W004)"
                )
                continue
            five_by_five, one_by_one = coords[0], coords[1]
            url = f"https://www.eorc.jaxa.jp/ALOS/aw3d30/data/release_v2404/{five_by_five}/{one_by_one}.zip"
            self.logger.info(f"Queuing request: {url}")
            urls.append(url)

        if not urls:
            self.logger.error(
                "No valid URLs generated from coordinates - aborting crawl"
            )
            return

        for url in urls:
            yield scrapy.Request(
                url=url,
                callback=self.parse,
                errback=self.handle_error,
                headers=self.headers,
                # Don't filter duplicates at the request level either
                dont_filter=True,
            )

    def handle_error(self, failure):
        """Log network/HTTP errors that would otherwise be silently swallowed."""
        self.logger.error(
            f"Request failed for {failure.request.url}: "
            f"{failure.type.__name__}: {failure.value}"
        )

    def parse(self, response):
        self.logger.info(
            f"Got response {response.status} from {response.url} "
            f"({len(response.body)} bytes)"
        )

        if response.status != 200:
            self.logger.error(
                f"Non-200 response ({response.status}) from {response.url} - "
                "check URL path"
            )
            return

        if len(response.body) == 0:
            self.logger.error(f"Empty response body from {response.url}")
            return

        try:
            with zipfile.ZipFile(io.BytesIO(response.body)) as zip_file:
                dsm_files = [f for f in zip_file.namelist() if f.endswith("DSM.tif")]
                self.logger.info(
                    f"ZIP from {response.url} contains {len(zip_file.namelist())} files, "
                    f"{len(dsm_files)} DSM.tif"
                )

                if not dsm_files:
                    self.logger.warning(
                        f"No DSM.tif found in ZIP from {response.url}. "
                        f"Files present: {zip_file.namelist()}"
                    )
                    return

                for file_name in dsm_files:
                    temp_path = str(self.temp_dir / os.path.basename(file_name))
                    with zip_file.open(file_name) as tif_file:
                        with open(temp_path, "wb") as out_file:
                            out_file.write(tif_file.read())
                    self.logger.info(f"Extracted {file_name} → {temp_path}")
                    self.tif_files.append(temp_path)

        except zipfile.BadZipFile as e:
            self.logger.error(
                f"Response from {response.url} is not a valid ZIP file: {e}. "
                f"First 200 bytes: {response.body[:200]}"
            )
        except Exception as e:
            self.logger.error(
                f"Error parsing response from {response.url}: {e}", exc_info=True
            )

    def closed(self, reason):
        self.logger.info(
            f"Spider closed. Reason: {reason}. TIF files collected: {len(self.tif_files)}"
        )
        if self.tif_files:
            self.merge_tiles()
        else:
            self.logger.warning(
                "No TIF files were downloaded - DEM will not be produced. "
                "Check the logs above for request/parse errors."
            )

    def merge_tiles(self):
        try:
            self.logger.info(
                f"Merging {len(self.tif_files)} TIF file(s) → {self.output_path}"
            )
            vrt_file = str(self.temp_dir / "merged.vrt")

            vrt = gdal.BuildVRT(vrt_file, self.tif_files)
            if vrt is None:
                raise RuntimeError(
                    f"gdal.BuildVRT returned None - input TIF files may be corrupt: {self.tif_files}"
                )
            vrt = None  # flush/close the VRT dataset before Translate

            result = gdal.Translate(self.output_path, vrt_file)
            if result is None:
                raise RuntimeError(
                    f"gdal.Translate returned None - could not write to {self.output_path}"
                )
            result = None  # flush/close

            # Cleanup tile files
            for file in self.tif_files:
                if os.path.exists(file):
                    os.remove(file)
            if os.path.exists(vrt_file):
                os.remove(vrt_file)
            if self.temp_dir.exists() and not any(self.temp_dir.iterdir()):
                self.temp_dir.rmdir()

            self.logger.info(f"Successfully merged tiles to {self.output_path}")

        except Exception as e:
            self.logger.error(f"Error merging tiles: {e}", exc_info=True)
            raise
