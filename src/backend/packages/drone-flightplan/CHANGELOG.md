# CHANGELOG

## drone-flightplan-1.0.0 (2026-02-10)

### BREAKING CHANGE

- Switch from minio to boto3

### Feat

- support Potensic Atom 2 Waypoint Missions (JSON Format) (#726)
- add helm chart for k8s migration (#591)
- **backend**: add opentelemetry instrumentation for arq worker
- **backend**: removing flight tails from uploaded imagery (#698)
- **backend**: photo upload upgrade fixes, plus additional classification and validation criteria for image uploads (#697)
- triggering processing workflow after new photo upload method (#691)
- classification workflow for imagery upload (#668)
- **backend**: add Sentry OTEL traces to prod (#675)
- improvements to imagery upload step using s3 multipart, per project file dump (#678)
- **frontend**: add a tooltip recommending the usage of waylines when a high number of waypoints are present (#670)
- **backend**: Public endpoints for accessing list of centroids and single project (#663) (#672)
- **frontend**: add sorting to contributions table and pretty task ID to map (#660)
- **drone-flightplan**: add support for Litchi CSV export + QGroundControl `.plan` JSON export (#646)

### Fix

- **frontend**: start to reword mapping --> flying #494
- **frontend**: display the task index on task click, not the uuid
- **backend**: correctly remove psycopg_pool verbose logs
- **backend**: hide verbose logs, move tif spider to arq worker job
- **backend**: ensure tif spider code is self-contained and uses /tmp, bump chart --> 0.1.5
- **frontend**: build issue after logic update
- **backend**: merge together classification & flight tail removal logic, fix up
- **backend**: decrease max concurrent file uploads to s3 --> 2
- **backend**: various image classification logic fixes, typing, ordering, race conditions
- **backend**: avoid error if s3 url pre-signing fails on project get
- **backend**: pre-commit issues / import errors
- **backend**: ensure existing tests all pass (#689)
- **frontend**: revert to maplibre demotiles for basemap
- **frontend**: add osm raster tile fallback on vector tile failure
- **backend**: OTEL follow up part 2 (#681)
- **hotfix**: missed import from removed FlightPlan enum
- **backend**: conflicting FlightPlan enum, remove DroneTM version (#679)
- **drone-flightplan**: suggest task split to user if flight time exceeds 80% of battery life (#664)
- **frontend**: remove unused prop and modify interfaces to fix build errors (#674)
- **backend**: implement cleanup of successful / failed NodeODM tasks (#658)
- **frontend**: task and individual project page console errors (#666)
- **frontend**: redirect to pages behind the login (#659)
- correct forgot password functionality (#661)
- **frontend**: use an anchor tag for correct semantics (#655)
- **frontend**: remove horizontal padding from app container
- **mapper**: mobile optimised layout, fixes #652

### Refactor

- tweaks to urls remaining as dronetm.hotosm.org
- various fixes, refactors, doc updates, mostly affecting s3 local dev usage
- remove dtm-data prefix from s3, replace all hardcoded to accelerate endpoint
- consolidate env vars to simplify deploy, update chart + compose to match
- rename Uploaded --> Pending for image classification process
- cleanup confusing unused code, swap frontend map legend order
- typo stepSwticherData --> stepSwitcherData
- replace all refs to 'develop' branch --> 'dev'

## drone-flightplan-0.4.1 (2025-10-16)

- capture edges on flightplan rotation
- auto-rotate based on task longest edge
- small bug fixed with hardcoded rotation val

## drone-flightplan-0.4.0 (2025-10-13)

### Feat

- add support for dji mini 5 pro, fixes #598
- add toggle to select drone type for flightplan generation & fix drone param calcs (#559)
- **drone-flightplan**: support for Potensic Atom 2 waypoint missions (#545)

### Fix

- **drone-flightplan**: cleanup setting gimbal angle for oblique and nadir shots
- **drone-flightplan**: for now do not adjust gimbal roll, just straight forward pitch
- **drone-flightplan**: ensure that flights complete (don't return) on controller transmission loss
- **drone-flightplan**: enable shootType=time for timed interval waylines
- **drone-flightplan**: attempt auto-start photo intervals on wayline mode
- **drone-flightplan**: update terrain following code to remove extra buffer points
- **drone-flightplan**: attempt another fix of straight line flightplans, no curve
- **drone-flightplan**: remove double end points for wayline missions (optimise curved --> straight)
- **drone-flightplan**: correctly set the flightplan to not curve (per point, as globally doesn't work)
- **drone-flightplan**: test creating straight line flight curvature
- **drone-flightplan**: ensure flight continue on signal loss
- **drone-flightplan**: potensic flights named per chunk
- **drone-flightplan**: set potensic atom 2 ground speed to 8 m/s max
- **drone-flightplan**: enable globalUseStraightLine=1 by default, fixes #524
- **drone-flightplan**: add **all** for top level imports from pkg

## drone-flightplan-0.3.7 (2025-04-07)

### Fix

- gimbal angle is set to -80
- rc lost action updated

## drone-flightplan-0.3.6 (2025-02-27)

## drone-flightplan-0.3.5 (2025-02-19)

### Fix

- duplicate points at the edge of a line in waylines

## drone-flightplan-0.3.4 (2025-01-22)

### Fix

- remove rotate point in final path

## drone-flightplan-0.3.4rc2 (2024-12-24)

### Fix

- missing last lines in line extracting function

## drone-flightplan-0.3.4rc1 (2024-12-23)

## drone-flightplan-0.3.4rc0 (2024-12-19)

### Feat

- add waypoints support to create_waypoint function

### Fix

- Handle out-of-bounds access in RasterIO and improve logging

## drone-flightplan-0.3.3 (2024-12-09)

## drone-flightplan-0.3.3rc2 (2024-12-09)

### Fix

- waypoint generation

## drone-flightplan-0.3.3rc1 (2024-12-09)

## drone-flightplan-0.3.3rc0 (2024-12-09)

## drone-flightplan-0.3.2 (2024-11-27)

### Fix

- add ground speed cap with safety buffer to prevent controller rejection

## drone-flightplan-0.3.1 (2024-10-14)

### Feat

- add logic to reverse initial path based on proximity to takeoff point
- update waypoints file
- update read me docs with all modules
- update read me docs

### Fix

- update distance calculation of first and last point based on tramsformer 3857 projection
- remove command to run waypoint
- remove python keywords from the docs copy command
- take photo action for waylines flight

## drone-flightplan-0.3.1rc4 (2024-09-12)

### Feat

- Add support for generating waylines when generate_each_points is False

## drone-flightplan-0.3.1rc3 (2024-09-10)

### Feat

- polygon edge coverage by adding extra waypoints
- add extra start and end waypoints for each row in aoi

### Refactor

- add type hinting, docstrings, and correct unit measurements

## drone-flightplan-0.3.1rc2 (2024-08-29)

## drone-flightplan-0.3.1rc1 (2024-08-20)

### Fix

- return path for flightplan

## drone-flightplan-0.3.1rc0 (2024-08-20)

## drone-flightplan-0.3.0 (2024-08-20)

### Feat

- create_flightplan module

## drone-flightplan-0.2.3 (2024-08-06)

### Fix

- relax pin for shapely '==' to '>='

## drone-flightplan-0.2.2 (2024-08-06)

## drone-flightplan-0.2.1 (2024-08-05)

## v0.2.0 (2024-08-05)

## v0.1.2 (2024-08-01)

### Fix

- gimbal angle issue for flightplans

## drone-flightplan-0.1.1 (2024-08-01)

## drone-flightplan-0.1.0 (2024-07-25)

### Feat

- program to generate waypoints within a polygon created
- generate waypoints in a polygon function
