# Generating Flightplans

## Manually Via Command Line

1. Calculate Flight Parameters:

   ```python
   python calculate_parameters.py \
       --drone_type DJI_MINI_4_PRO \
       --forward_overlap 70 \
       --side_overlap 70 \
       --altitude_above_ground_level 115 \
       --image_interval 2
   ```

   > This will output a JSON that can be used in step 5 below.

2. Creating Waypoints:

   ```python
   python waypoints.py \
       --project_geojson_polygon aoi.geojson \
       --altitude_above_ground_level 115 \
       --forward_overlap 70 \
       --side_overlap 70 \
       --generate_each_points \
       --take_off_point LON,LAT \
       --output_file_path ./waypoints.geojson
   ```

3. Add Eleveation Data From A DEM File:

   ```python
   python add_elevation_from_dem.py dsm.tif waypoints.geojson waypoints_with_elevation.geojson
   ```

   > Here we need a DEM in .tiff format.

4. Create Placemark File (For KMZ File):

   ```python
   python create_placemarks.py \
       --waypoints_geojson waypoints_with_elevation.geojson \
       --parameters '{"forward_photo_height": 84.0, "side_photo_width": 149.0, "forward_spacing": 20.95, "side_spacing": 44.6, "ground_speed": 10.47, "altitude_above_ground_level": 115}' \
       --outfile placemarks.geojson
   ```

5. Create WMPL Flightplan:

   ```python
   python output/dji.py \
       --placemark placemarks.geojson \
       --outfile flightplan.wpml
   ```
