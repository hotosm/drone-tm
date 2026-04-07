## 2026.2.4 (2026-04-07)

### Fix

- **backend**: enable download of all ODM assets by anyone, until better roles impl
- **backend**: avoid false positive task restarts for reconciliation workflow
- **backend**: missed variable task_count --> total_task_count to enable final processing

## 2026.2.3 (2026-04-03)

### Fix

- **backend**: move odm asset processing to arq worker to avoid livenessProbe timeouts

## 2026.2.2 (2026-04-03)

### Fix

- out of memory error during ODM assets.zip extraction, robust stream-zip implementation (#768)
- **backend**: add lru_cache to s3 client init (prevent multiple inits)

## 2026.2.1 (2026-04-02)

### Feat

- **frontend**: wrapping flight gap identification in UI (#738)

### Fix

- **backend**: s3 urls don't need path bucket prefix when using cloudfront

## 2026.2.0 (2026-04-01)

### Feat

- fix processing issues with webhook, ODM job queue, CTRL+click for custom ODM

### Fix

- only display odm task queue for pending, queued, failed
- **frontend**: display the project/task uuid on the detail pages
- fix #426 fix #190, user friendly urls instead of UUIDs (internal only)
- **frontend**: properly fix ##606 for multipolygon aoi merging
- **backend**: PostGIS functions for geom merge project creation
- **frontend**: add app version number to top left, better indicate when updated
- **frontend**: fix #277 for better use creation flow
- **#735**: integrate geojson-aoi-parser for robust AOI parsing (#752)

### Refactor

- **drone-flightplan**: cleanup some missing print statements

## 2026.1.3 (2026-03-31)

### Feat

- add option to mark task as 'fully flown' on task detail page

### Fix

- **backend**: ensure UNLOCKED tasks transition to HAS_IMAGERY on image upload
- **frontend**: remove 'Something went wrong' fallback, replace with spinner
- **frontend**: don't hide the project page redirect on mark fully flown
- **frontend**: fix #530 when drawing geoms during project creation
- **backend**: properly fix log propagation for psycopg_pool

### Refactor

- **frontend**: tweaks to ui / comments for task popup
- **frontend**: tweaks to the ui for statuses project map
- redesign the events and task states throughout the app + `FULLY_FLOWN` state (#757)

## 2026.1.2 (2026-03-30)

### Feat

- **qfield**: commit working implementation of qfield plugin flightplan gen

### Fix

- **backend**: url pre-sign issue against cloudfront during processing in prod
- **frontend**: allow adding comments to locked tasks, partial #750
- **frontend**: only register hot cookie banner (matomo) in production
- **backend**: suppress verbose db pool connection logging on prod
- **qfield**: tweak plugin to auto-pan to flightplan after gen + scroll down on dialog
- **qfield**: ensure the js flightplan output matches the python one exactly
- **frontend**: ensure adb flightplan copy implementation for dji works in correct dir
- **frontend**: tutorial videos loading, no longer require pre-signing

## 2026.1.1 (2026-03-26)

### Feat

- **gcp-editor**: move gcp-editor to monorepo here, ol --> maplibre, fix up workflow with current code

### Fix

- **frontend**: improve visual consistency of design / radio buttons
- **frontend**: surface the manual rejection override button for the user
- **frontend**: minor fixes after gcp editor integration
- **gcp-editor**: remove @tailwind base to avoid preflight reset on main app
- **frontend**: fix broken pnpm lock file after merge
- **frontend**: small styling override from gcp-editor
- **frontend**: update hotosm/ui to avoid module register error

### Perf

- **frontend**: lazy load frontend components, use webp over png, optimise first page load (#744)
- **frontend**: replace huge mobile .svg --> tiny .webp file
- **frontend**: compress png --> webp for landing images, update refs, remove unused
- **frontend**: lazy load components, preload css / imgs, font swap css - improve FCP

## 2026.1.0 (2026-03-23)

### BREAKING CHANGE

- Switch from minio to boto3

### Feat

- **backend**: flight gaps and creating a reconstructed flightplan based on missing imagery (#723)
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
- **qfield**: start work on qfield flightplan generation plugin

### Fix

- finalise photo uploader workflow (separate dialogs, review map, edge cases & resiliency) (#733)
- **frontend**: ui adjustments to photo upload flow (#727)
- **backend**: ensure OtelSettings ingerit LOG_LEVEL from primary settings
- **backend**: pydantic Config deprecation
- **frontend**: if no DEM is present when it should be, warn user
- **backend**: upgrade scrapy, use Async crawler to avoid issues on subsequent download
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
- **drone-flightplan**: suggest task split to user if flight time exceeds 80% of battery life  (#664)
- **frontend**: remove unused prop and modify interfaces to fix build errors (#674)
- **backend**: implement cleanup of successful / failed NodeODM tasks (#658)
- **frontend**: task and individual project page console errors  (#666)
- **frontend**: redirect to pages behind the login (#659)
- correct forgot password functionality (#661)
- **frontend**: use an anchor tag for correct semantics (#655)
- **frontend**: remove horizontal padding from app container
- **mapper**: mobile optimised layout, fixes #652
- use ExpressionEvaluator for DEM sampling
- **backend**: multipolygon parsing during project creation, fixes #606
- **backend**: Local Development Setup (#630)
- **drone-flightplan**: cleanup setting gimbal angle for oblique and nadir shots
- **drone-flightplan**: for now do not adjust gimbal roll, just straight forward pitch

### Refactor

- remove redundant JAXA_AUTH_TOKEN
- tweaks to urls remaining as dronetm.hotosm.org
- various fixes, refactors, doc updates, mostly affecting s3 local dev usage
- remove dtm-data prefix from s3, replace all hardcoded to accelerate endpoint
- consolidate env vars to simplify deploy, update chart + compose to match
- rename Uploaded --> Pending for image classification process
- cleanup confusing unused code, swap frontend map legend order
- typo stepSwticherData --> stepSwitcherData
- replace all refs to 'develop' branch --> 'dev'
- update test qgis plugin - making more progress!
- **backend**: fix typo in total_image_count var

## v2025.4.0 (2025-10-03)

### Feat

- **frontend**: add temp component to adjust gimbal angle for flightplans
- **backend**: add gimbal rotation option for flightplan generation
- add support for dji mini 5 pro, fixes #598
- Update mobile app apk download link
- add support to push flightplans directly to device via WebUSB ADB (#570)
- add toggle to select drone type for flightplan generation & fix drone param calcs (#559)
- add easy install webodm script
- **drone-flightplan**: support for Potensic Atom 2 waypoint missions (#545)

### Fix

- enable go to task for everyone even it is locked
- merge issue
- **drone-flightplan**: ensure that flights complete (don't return) on controller transmission loss
- **frontend**: missed passing gimbalAngle when updating takeOffPoint
- **frontend**: no initial value for gimbalAngle = no flightplan
- **frontend**: line between two menu items
- **backend**: put the task id first in the flightplan kmz file download
- **frontend**: add numerical task index to flightplan filename, fixes #319
- **frontend**: incorrect terrain follow param on project description
- **backend**: fixes #552 add project task download with useful info
- typo for key for terrain following
- remove required for fields in basic detail form
- **drone-flightplan**: enable shootType=time for timed interval waylines
- **drone-flightplan**: attempt auto-start photo intervals on wayline mode
- **drone-flightplan**: update terrain following code to remove extra buffer points
- **drone-flightplan**: attempt another fix of straight line flightplans, no curve
- **drone-flightplan**: remove double end points for wayline missions (optimise curved --> straight)
- **drone-flightplan**: correctly set the flightplan to not curve (per point, as globally doesn't work)
- **drone-flightplan**: test creating straight line flight curvature
- **drone-flightplan**: ensure flight continue on signal loss
- update tutorial links, add rc file transfer by app tutorial
- **frontend**: update recommended side overlap, based on #509
- update CNAME for docs site
- **backend**: update add_elevation_from_dem.py to swap dem coords (GDAL change) (#590)
- **drone-flightplan**: potensic flights named per chunk
- **backend**: split flights into 10 point chunks, for easier resume
- **drone-flightplan**: set potensic atom 2 ground speed to 8 m/s max
- **frontend**: minor typing error
- **drone-flightplan**: enable globalUseStraightLine=1 by default, fixes #524
- **frontend**: set default flightplan mode to waylines, fixes #547
- **backend**: minor fixes after merge
- **backend**: standardise usage of drone_flightplan global module exports

### Refactor

- cleanup dji xml exitOnRcLost actions
- **frontend**: make download selection options clearer to user
- run spellchecker on entire codebase
- add domain for docs page
- fix typos in toast notifications
- **frontend**: minor dependency cleanup and unused components using knip
- **frontend**: fix minor ts linting errors
- **frontend**: run eslint linter --fix
- update drone-tm/pgupgrade --> hotosm/pgupgrade img

## v2025.3.2 (2025-04-09)

### Feat

- render `NoDataComponent` with proper message insted of `No data found` plain message
- add `NoDataComponent` component to show on empty data list
- add `All Projects` option on filter projects by status
- **main-dashboard**: implement filter on map
- **main-dashboard**: implement filter on map
- add and customize no-fly-zone
- **create-project**: show no fly zone on map
- add totalNoFlyZoneArea storing variable on redux slice
- **useDrawTool-component**: cursor style update on mode change
- fix error message typo
- save total project area on redux state
- **project-creation**: update UI of Define AOI step and enable project area edit on map
- **project-creation**: validate total project area
- **project-creation**: refactor code and UI of Define AOI step
- increase the task size to 1000m

### Fix

- **backend**: invalid exports using __all__ in drone-flightplan
- remove padding top on project dashboard map
- popup open on download or orthophoto visibility button click
- waypoints module import issues
- import from the droneflightplan package
- **drone-flightplan**: add __all__ for top level imports from pkg
- **backend**: restructure encryption logic to prevent cyclical imports
- upload to OAM button hidden
- correct WKB to GeoJSON conversion in task processing

### Refactor

- **backend**: add extra logs to waypoint + dem generation, include traceback
- **backend**: add logs if JAXA DEM download scraping or upload fails
- add warning log if is_terrain_follow but DEM access fails
- **backend**: add is_terrain_follow to project response to easily verify

## v2025.3.1 (2025-03-05)

### Feat

- show message received as response and refetch project description on upload to OAM success
- update string formating utils
- show upload to OAM only if the oam status is `NOT_STARTED` or `FAILED`
- show `Upload to OAM` button only to the author of the project
- show progress on early (on url fetch)
- **image-upload**: show uploading image progressbar on description section disable upload button if upload is in progress assets info refetch on upload image status update
- **image-upload**: change style of points selected for delete
- **project-description**: toggle project area visibility
- add default tags
- **project-description**: show start processing if any of the task image upload is completed
- add button to upload to OAM on project description section
- create modal for uploading to OAM with tags
- add oam token update field
- clear visible orthophoto list on project description page unmount
- remove project details query on component unmount
- add project id on orthophoto source memo dependency
- add project id on project detail query key
- **task-description**: show start-processing button even if all selected images are not uploaded
- add talk to us section
- **task-description**: zoom to orthophoto
- **upload-images**: wrap upload section with error boundary
- **upload-images**: update text of showing the % of image lies inside the project
- upgrade `react-tostif` to `11.0.0`  to make compatible with react v19
- update lock file
- import and add `HotTracker` component on App.tsx
- create `HotTracker` component
- filter projects by status
- update tooltip message
- zoom to project area
- zoom to extent on project section
- zoom to task area on task area visible
- show task area and % of uploaded images from within the project area
- save task area on state
- add `@turf/boolean-point-in-polygon`
- add error boundry
- **individual-project**: skeleton loader description data fetching and clear state on component unmount
- skeleton loader on individual project description
- filter projects by status
- add matomo cookie acceptance banner on home page
- **individual-project**: update download assets button
- implement selection delete point images
- visible delete project button only for the project creator
- implement delete project feature
- create delete project confirmation prompt
- download final result
- **task-description**: use separate api for assets data insted of using task description data
- **project-description**: show processing button only if the any of the task has completed the processing
- show confirmation dialog on task unlock
- create `ProjectPromptDialog`
- create `UnlockTaskPromptDialog`
- add tutorial page
- create video card component
- add video player component
- add tutorial route and navigation link on navbar
- remove navbar of tutorials page
- add `@react-spring/web` for animation
- add video list constants
- show task unlock button to project creator
- reload page on regulator exists the page
- show additional information on project description
- **task-description**: enable zoom to layer feature on task orthopoto
- update mobile apk download section design
- zoom to orthophoto of overall project
- show `no data available` message if there is no data
- update dashboard card design
- **landing-page**: remove unnecessary image
- **landing-page**: add mobile app download section
- **individual-project**: visualize and toggle overall project orthophoto
- toggle tasks orthophoto visibility from table row
- **individual-project**: store visible list of orthophoto sources on redux state
- add key on breadcrumb items
- popup toast message on processing started
- render buttons as per project processing status
- update processing starter parameter on individual project
- add toas message on processing started
- update process imagery service
- add `ChooseProcessingParameter` modal compoennt to choose processing parameter
- prevent multiple event trigger on gcp editor component
- show upload progress on task description section
- save upload progress details on redux
- add upload progress state on task details slice
- add progress bar component
- hide start procesing button if `image_processing_status` id `SUCCES`
- add project and task on download file
- export project info
- create mapsection for export section
- create export section page
- add `preserveDrawingBuffer: true` to preserving the drawing buffer
- **task-description**: downlaod rotated plight plan .kmz file
- **task-description**: use rotation angle of redux state as a final rotation angle
- **task-description**: store rotation angle on redux store

### Fix

- change state migration file
- copying file within s3 bucket
- circular import problem in oam.py
- update project oam status api
- docker-compose.vm.yml volumes arq-worker
- map section of mobile view
- project creator can upload images, state change fix
- format
- query params on project listing api
- update logon  on sigin overlay
- show overall project orthophoto toggle icon
- indentation
- invalidate assest-info query after upload success
- typo
- crash issue because of distructure of map style
- removed files not other than odm accepted files in processing
- wrap query key with `[]`
- **frontend**: import hotosm/ui javascript files, add custom type declaration
- **frontend**: final fixes to typing, add custom react declaration extending types
- replace tanstack useQuery onSuccess
- tanstack incorrct useMutation
- turf AllGeoJSON comparison on .flatten()
- redux-persist typing errors
- add RootState prop for redux reducer
- replace tanstack query mutation isLoading prop --> isPending (rename)
- redux toolkit now correctly infers state types, remove IRootReducer
- tanstack query usage of invalidateQueries usage include {queryKey: xxx}
- **frontend**: replace JSX.Element with React.JSX.Element
- usage of CombinedState in reduxjs/toolkit (deprecated)
- re-enabled hot-tracking matomo component (react 19 required)
- duplicate code in webhook implementation
- random uuid is removed from image names
- comment `HotTracker`
- hot-tracking does not exist on type JSX.IntrinsicElements ts error
- task area/flight plan toggle
- task schemas created_at made optional
- redirect to login if the user includes a `REGULATOR` role
- **regulators-page**: clear localstorage while redirection through the url
- show start processing button
- remove white space
- change password issue
- add type guard on user-profile image
- image processing failed condtion
- cannot removed source the layer is using it
- url for assets and project orthophoto
- white space formating

### Refactor

- convert splash bg image from png --> compressed jpg
- add button text and close popup on button click props
- `Vector Layer` component

## v2025.1.0 (2025-01-25)

### Feat

- **project-description**: call assets api only on contirbution tab is on view
- **individual-project**: get assets list
- **task-description**: update assest information api endpoint
- added users authentication
- added new assets download endpoint
- added asgiref package to convert the async to sync function
- **project-dashboard**: update map and project card style
- **project-dashboard**: udpdate row per page options
- **project-description**: increase opacity of task completed tasks fill color
- **project-details**: image processing status text update
- reduce table height
- **project-description**: add different color code as per project status on properties of projects geojson
- fill circle color code from properties on VectorLayerWithCluster component
- **project-dashboard**: show complete status on project card
- add Status chip component
- **dashboard**: make logs table responsive
- refine the status of tasks
- update the status of each projects on projects list endpoint
- update task state to reflect the start of image processing
- updated the task as completed after process from s3
- **project-details**: show loader on table
- **project-details**: fill different color for completed task and image uploaded task
- **project-details**: show skeleton on project data fetching
- **project-details**: add new status on legend
- **dashboard**: show slug on project card
- **dashboard**: update UI and pass other project details on project card props
- **projects**: Show status on project card
- **dashboard**: show user role
- updated downlaod assets url
- **user-profile**: redirect to complete profile on google auth success
- **user-profile**: redirect to complete profile page if the user not completed the signup
- **user-profile**: show error message
- **user-profile**: update password
- **user-profile**: update other details
- **user-profile**: update organization details
- **user-profile**: call user details api on userProfile of nav section
- **user-profile**: create user profile patch service
- store user details on local storage on fetch success
- **user-profile**: update basic details
- remove the route `user-profile` add `complete-profile` from the list of routes without navbar
- **user-profile**: add UpdateUserProfile component
- add common css class main-content that gives the full screen height after reducing the nav bar height
- **update-profile**: add OtherDetails component
- **update-profile**: add Password component
- **update-profile**: add OrganizationDetail component
- **update-profile**: add Header component
- **update-profile**: add BasicDetails component
- replace user-profile layout component and and add new route called complete-profile
- add Breadcrumb component
- update file and folder structure and rename `UserProfile` to `Complete UserProfile`
- **user-profile**: pass watch on form props
- added search features in projects read endpoit
- **task-description**: show task locked date
- **individual-project**: post date with other data on task lock/unlock
- added change password based on old and new password
- added two new enums such as IMAGE_UPLOADED & IMAGE_PROCESSED
- added updated_at in task details endpoint
- added updated_at field  when user request, lock, unlock task
- added updated at field in task events table
- **task-description**: update button text `Starting Point` to `Take Off Point`
- add return type of `retryFc`
- added users list endpoints
- updated permission on delete projects, only project creator can delete the projects
- **task-description-image-upload**: implement `retryFc` to retry the api in case of upload failure after 1 sec
- **task-description**: retry image processing trigger api failure if the status code is 304 and the failure is less than 5 times
- **task-description**: trigger the image processing starter api on completion of image uploads
- **project-creation**: show recommended value on task split dimension
- **landing**: add jamaica flying lab logo as a offical training partner
- **landing**: add jamaica flying lab logo as a offical training partner
- **project-dashboard**: show `No projects available` if there is no projects
- **task-description**: download task area on kml/geojson format
- added KML download format in download boundaries API
- **task-description**: show only the download result button if orthophoto is available
- **dashboard**: make responsive
- **dashboard**: show project name on task logs and request logs
- **project-dashboard**: add dropdown for owner projects filter
- **project-dashboard**: apply projects filter by owner
- added project name list tasks based on user endpoint
- **user-profile**: make responsive
- **task-description**: implement each-task orthophoto download
- **task-description**: re-fetch uploaded information and close file upload modal on file all files uploaded successfully
- **user-profile**: make responsive
- **update-profile**: update placeholder text
- implement scroll to top on all pages
- make navbar fixed height
- add `ScrollToTop` component
- **task-description**: all the variables related to take-off point updation reset to initial state on component unmount
- **project-description**: show unlock button only if the task is locked by the same user
- **project-dashboard**: border radius on map
- **project-description**: make responsive
- tooltip for base layer switcher
- **project-description**: implement task unlock feature
- add secondary button on `AsyncPopup` component
- **task-description**: close modal only instend of redirecting to dashboard
- **task-description**: mobile responsive file upload section
- **task-description**: update flight take off point  point
- **task-description**: find bbox with updated take-off point and fit bounds to the bbox
- **task-description**: add waypoint endpoint
- **task-description**: plot new takeoff point geojson on map
- **task-description**: get coodrinates of  current user location or by clicking on map and save as a geojson on state
- add ShowInfo component to show information on map
- add component to get coordinates on mouse click
- add turf/helpers package
- **task-description**: add radio button to as take off point updation options
- **task-description**: create popup to choose take off point updation option
- **task-description**: make mobile responsive
- add useWindowDimensions hook
- **task-description**: update download flight plan design
- **task-description**: update popup data
- added user info in dependency
- Implement forgot password functionality with email reset link
- **project-creation**: add task generation info text
- add counts for total tasks and ongoing tasks in project retrieval
- **landing-page**: remove unused links
- **landing-page**: add jamaicaFlyingLab on client section
- round off to 2 decimal values the return value of side/front spacing converter function
- **project-creation**: replace switchTab with radio button to choose value type (altitude/gsd, overlap/spacing)
- add SwitchTab component
- **project-creation**: show equivalent overlap and spacing value of entered value as a info text
- **project-creation**: convert front and side space into front and side overlap on project creation payload
- roundoff to two decimal values on sideOverlap and frontOverlap values
- **project-creation**: add radio button to choose to input image overlap or image spacing and show input fields accordingly
- create utils function `getForwardSpacing`, `getSideSpacing`, `getSideOverlap` and `getFrontOverlap`
- **project-creation**: show entered gsd/altitude equivalent values as a info text
- create utils function `gsdToAltitude` and `altitudeToGsd`
- add InfoMessage component
- **project-creation**: add task dimension limitation to 50-700
- **project-dashboard**: show project id insted of slug on project cards
- add proper execption handling in reset task
- add exception handling in get task state
- add reset task if locked
- Add optional filter for projects by current user
- **user-profile**: hide country_code
- **task-description**: download waypoint geojson
- **project-dashboard**: show popup on project click, the popup content has name id and go to project details button
- **project-dashboard**: increase project centroid pointing circle radius
- **project-dashboard**: remove center to nepal and set center to [0, 0] show all projects in the world with clustering
- **project-dashboard**: visible map by default
- updated the directory of task images path
- updated the  directory of dem and map images on s3 bucket
- added the default site url for localhost
- added the dynamic site url for email notifications
- Automatically approve task locking when requested by project owner
- api download if split_area is false
- added exception handling on get task geometry
- added download tasl boundaries
- **task-description**: get `taskId` and `projectId` from url using `window.location.pathname` insted of `useParams`
- **task-description**: get `taskId` and `projectId` from url using `window.location.pathname` insted of `useParams`
- **project-creation**: add static form description
- **project-creation**: add base layer switcher and navigate to current user location button on AOI fill up step
- **task-description**: add base layer switcher and navigate to current user location button
- **project-dashboard-card**: refactor card UI styling and add project image
- **project-creation**: add new line typed layer on generate task to customize tasks outline style
- **project-creation**: capture map section and save as a file on redux state
- **project-creartion**: clear split geojson field and captured image state to false before task spliting api response
- **project-creation**: add map image on payload and set loading state true while capturing image
- **individual-project**: add geolocate control to redirect user to current location
- **individual-project**: add base layer switcher
- add `LocateTheUser` component to redirect user to their current location
- **individual-project**: add `BaseLayerSwitcherUI` for baselayer switching
- update the base layer list
- added logic to merge small polygon to near one smallest polygon
- Improve small polygon merging logic in splitBySquare method
- **task-description**: flight plan download using fetch and Blob
- **individual-project**: by default legend open and fix expand more/less issue
- **dashbaord**: add replace task id with task project task index
- **task-description**: add point count on description section
- added new image_url to store image file to s3 buckets
- **create-project**: add loader on project creation
- add link to edit profile
- add link to documentation
- **task-description**: show popup only on specified sources
- add `ShowPopup` props on `AsyncPopup` component that accepts the function that returns the boolean value
- added project_task_index on  user task details endpoint
- Add no-fly-zones on project details
- update request function for auto approval
- shift the _shemas to _crud.py
- drone deps to get one drone
- DbDrone schema with crud functions
- working project routes using psycopg + pydantic models
- CI: use gh-workflows based deployment
- update GSD unit
- **individual-project**: show no-fly zone popup on nofly zone click
- **task-description**: refactor images uploading process
- **task-description**: refactor uploading images preview popup
- **tsak-description**: remove preview images from selected folders use icon insted cause it takes time to preview all the image if images are in large number or size
- **project-dashboard**: show slug insted of id on cards
- convert project area m2 to km2
- add converter function `m2ToKm2`
- **project-creation**: make project description input a text area
- **dashboard**: wrap requested task listing component with hasErrorboundary
- **task-descripion**: add altitude on waypoints point click popup
- **task-description**: show description on popup of waypoints point on click
- get coordinates on properties on map feature click
- **project-creation**: add option to input `GSD` or `altitude`  on project creation
- **project-creation**: add measurementType state on redux slice
- **individual-project**: show no-fly-zone on map
- **individual-project**: add legend on map
- create Legend component
- **individual-project**: show project boundary on map
- **project-description**: round off area to 3 decimal place and use task index insted of task id while displaying on task list
- Add no-fly-zones project details
- **individual-project**: remove index sent as an id prop on task rendering vectorLayer
- **task-description**: implement refactored response data on waypoints
- add `imageLayerOptions`  prop to `vectorLayer` component
- add `turf/meta`
- added pagination on list tasks
- added login auth on project read endpoint
- added project creator
- Update SQL query to insert multiple task events and refine the endpoints to include statistics and list all task statuses
- **individual-project**: list completed and ongoing tasks on contirbution section
- redirect to project dashboard on icon click
- **individual-project**: update task locking flow with detailed info
- **individual-project**: pass locked user id and name to properties of each tasks geojson
- **individual-project**: different popup message for unflyable tasks on map
- update name, task_area, user_id & user_id in project details endpoint
- **dashboard**: update body for rejecting `request for mapping` and update the request logs and count
- update request function for auto approval
- **individual-task**: set style and show toast message as per approval require for mapping
- Add requires_approval_from_manager_for_locking field to read_project endpoint
- **landing-page**: hide signin button and display button to redirect to dashboard if user is logged in
- **dashboard**: update request log api
- add wrap with `hasErrorBoundary` component to prevent the whole page crash issue
- **task-desctiption**: filter data
- solve merge conflicts
- **project-description**: update waypoint style on map
- add `iconAnchor` props on `VectorLayer component
- **project-description**: update design
- **project-description**: downlod flight plan
- **project-description**: implement api to show individual task description
- **task-description**: show project name on breadcrumb
- optimize code, add components
- retrieve taskId and projectId from params
- add progress bar image uploading
- add popover for images selection
- add preview Image component
- add image card component
- add task id retrieving from URL
- add action and reducer for droneOperatorTasks
- add callApiSimultaneously util
- add createChunkOfArray  util
- add delay creator  util
- add percentageCalculator util
- resolve merge conflicts
- **individual-task**: show waypoints on map
- **individualTask**: fetch task waypoint
- add `symbolPlacement` props to `VectorLayer` component
- **task-description**: refactor folder structure and path
- add service for image upload
- add feature to upload folder
- add props for files count
- **dashbaord**: update task state text for filter
- **dashbaord**: add padding on task listing table row
- **dashboard**: implement task listing api
- **dashboard**: create TaskLogsTable
- update SQL query to map integer states to text with default for unknowns
- **dashboard**: show statistics loadings state
- **dashboard**: update card UI
- **dashboard**: implement api to to show tasks status with count
- **dashboard**: show request log count
- **project-creation**: accept only tiff/tif file as dem data
- **project-creation**: update manager aproval for locking task key and form UI
- add comment to task event update and render project ID when listing all tasks.
- Add statistics endpoint of task
- added task route
- added task ongoing, completed &  requests count
- add popover for loading
- change files destination
- add componet for map section
- add slicer for drone operator page
- add route for drone operator task page
- add constants for drone operator task page
- add drone operator task header
- add question box component
- add description and uploads component
- add description box compoent
- add drone operator task page
- **project-creation**: update keys,refactor payload and post body as form data
- **project-creation**: update final output option values and front/side overlap keys
- **project-creation**: update key `dimension` to `task_split_dimension`
- **project-creation**: add opitons to set required/not-required approval for locking task for mapping
- Update  field to use  type
- change auto lock message and add TODO for function refactor
- Add automatic task lock option for project creators & drone operators
- **project-creation**: send post payload data as form data
- **project-creation**: make `Instructions for Drone Operators` and `Deadline for Submission` optional
- **project-creation**: add `side_overlap_percent`, `forward_overlap_percent and `dem` data uplaod`
- refactor common component `UplaodArea`
- **services**: add request and response interceptors to handle access and refresh token expiry
- **project-creation**: add `image overlap` and `final output type` fields on form
- **dashboard**: add accept/reject task mapping request functionality
- **dashboard**: get requested task list
- **dashboard**: update cards UI to show active
- **profile**: show more details on profile section
- **projects**: make request for  mapping task
- add endpoint to list all tasks for drone user with role validation
- **project-creation**: set tasks style and popup message as per task staus on map
- add button hide props on map popup component
- add image loading feature on `vectorLayer` component
- **create-project**: draw multipolygon no fly zone on Define AOI step
- **useDrawTool**: hide tooltip on cursor
- Implement read, create & delete operation on drone table
- Implement deletion of drone and associated drone flights in one query
- Add read-all operation for drones with schema validation
- Add delete operation for drone with schema validation
- Implement create & read operations for drone with schema validation
- run pre-commit hooks
- added slug on project table
- changes filename
- add email notification for mapping request approval & mapping request rejection
- Filter pending tasks by state in function
- add popup to tasks section
- change popup height
- add services for task state
- add a pop up to tasks map section
- add selectedTaskId to global state
- modify the asyncpopup component to incorporate dynamic button text
- combine tasks geojson from api into one
- fetch user profile when signing in with email and password
- add service for user Details
- change the logo in navbar to black
- use userDetails from google-login in profile section
- create a util function that parses the object from localstorage and returns value
- **project-creation**: Area validation on file upload as project area and no fly zone
- refactor `UploadArea` component to set validation from outside the component
- **projectDashboard**: cluster projects on map view
- **Buttons**: add hover effect(underline text) on button hover
- create `VectorLayerWithCluster` component
- clear formstate after creating a project
- add GFDRR logo to landing page
- add 100km validation to drawn areas
- enable draw and reset project ares
- close the modal when navigating to projects section
- add reducer to reset drawn areas to initial state
- add type to geojson
- enable draw project area in define AOI section
- modify useDrawTool
- add a util reverseLineString
- add package mapbox-gl-draw-cutline-mode for drawing polygons
- add refresh token to local storage
- add modal to warn user of unsaved changes while exitting create project form
- hide add project button when signed in as drone operator (#79)
- add logic to split project shape by no-fly zones
- handle multiple polygons and multipolygons in no_fly_zones
- **run**: pre-commit on local
- **auth/profile**: solve refresh token access and update profile with PATCH method
- add contributor, task state, and outline to project detail API
- add gdal  & fix: cluster name from secrets
- remove unnecessary field from projects schema
- added multipolygon_to_polygon in no_fly_zones
- run pre-commit hooks on backend code
- added deadline column for projects
- **project-creation**: Enhance schema with new fields and update metadata handling
- userprofile added for project creator
- run pre-commit hooks on backend code
- retrieve all projects based on author
- run pre-commit hooks on backend code
- add authentication and UUID to project creation; validate DB results with Pydantic schemas
- change favicon for the project
- change the dtm logo to red in navbar and signin overlay of landing pagwe
- navigate to projects sections if user is already logged in
- add button to navigate to landing page from login
- add back button in forgot password section
- add ci for database migrations
- change default route to / from /login
- add navigation to sign in page after click in dashboard
- add components for the landing page
- add custom accordion component
- add global state for showmenu
- add animations and constants used in landing page
- add landing page route in appRoutes
- add framer-motion package for landing page animations
- add asssets used in landing page
- individual project initial slicing
- upload project boundary when creating project
- able to draw in define aoi in form section
- implement api in projects section and add skeleton
- zoom to layer in project card map section
- add skeleton component for project cards
- add individual project routes in appRoutes
- complete google auth component
- add project list api in services and api folders
- add projectId to global state
- add service to upload task boundary
- add zoom to layer in create project forms map
- add package @turf/bbox to get bounding box of geojson
- add global state for userprofile tabs section
- add userprofile view
- add tabOptions for userprofile section in constants
- add custom component Tabs for userprofile section
- create form components for userprofile section
- add font Manrope and update tailwind config for landing page
- Implement raw query on register user & login user
- Implement raw query on project lists
- Implement encoode database connection & Add project creation, task creation endpoint with raw SQL queries
- Add deletion of associated tasks when deleting a project
- extra cors from environment and Key Check on docker-entrypoint in frontend
- dockerized frontend
- Implement bbox info on project list
- transferred dtm frontend to dronte tm
- add endpoints and functions for project retrieval
- callback endpoint
- google login endpoint
- callback endpoint
- google login endpoint
- compoes file updated for alembic migration
- me endpoint created which provides the current user info
- updated user models
- login api
- updated user models
- login api
- take photo at each point in kml file
- take photo at each point in waypoints
- generate each waypoints within a wayline
- generate waypoints for drones endpoint
- waypoint_crud api added

### Fix

- set default rotation angle to 0
- update response for flight plan
- slove task locking and validation error in project creator (#381)
- **prd**: slove the status not updated after image processing
- reslove project completed status after images processing
- reslove email notification issues on valid author (#293)
- merge conflicts
- update the pdm lock file
- resolve merge conflict with main
- **backend**: reslove merge conflict with main branch
- **backend**: reslove merge conflict in pyproject.toml
- **backend**: returns values from calculations function
- **backend**: reslove merge conflict in pyproject.toml
- merge conflict
- merge conflict
- **task-description**: set height to update takeoff point button section (#281)
- **project-details**: add `/` on api endpoint
- remove await from assets download endpoint
- optimize project status calculation logic & update ongoing status count.
- update ongoing_task_count to count tasks in specific states of projects
- completed task status count
- resolve RuntimeError for missing event loop in AnyIO worker thread
- **task-description**: set height to update takeoff point button section
- merge conflict
- added asyncio event loop to call async update_task_state in process_images_from_s3
- **project-details**: available tasks not showing on table
- reslove merge conflict project and task schema
- refine the state of task processing
- adjust the state based on processing...
- remove comment from the task update function
- merge conflict
- **update-userProfile**: update background color
- **individual-project**: download orhophoto
- **individual-project**: table UI
- typo
- **user-profile**: navigate to complete profile only after the profile fetching is completed
- **user-profile**: minor UI
- **ser-profile**: make patch request on profile data change
- typo
- minor style
- typo
- added message if user do not sent old and new password
- issues reslove on updated date
- **task-description**: Remove BLOB middleware for processing result downloads
- get superuser from user table instead of access token
- handle exception if project not found in db
- **task-description**: date format
- status code for retrying
- merge conflict
- return empty list if project not found
- convert the str geomerty into feature collection
- **project-creation**: show error message detail insted of error message on post
- **task-description**: task description comments
- **task-description**: click event persists after the starting point is saved
- presigned url expiry time
- merge conflict
- return of get_take_off_point
- function to put file to s3
- assets extension
- dem file not found issue in waypoints
- changes area threshold
- map width in project detail page
- splitting project area into multiple taks
- increase reset password token expire time
- added exception handling in get user by email
- added password reset templates instead of plain text
- login issues with username & password
- merge conflict
- **individual-project**: show popup to lock task if there is no task status found
- **project-dashboard**: map crash issue on 0 project
- changes reset to unlock key
- Change user_id type from UUID to str
- **project-dashboard**: project list responsive
- dem path when downloading flightplan
- changes site_url to frontend url
- remove print line from user schemas
- remove commented code
- issues reslove on single task area download
- move base layer switcher before waypoint layer
- check if map is loaded before adding baselayer
-  revert the .toml & .lock file
- restore the pdm lock & pyproject.toml
- download fligh plan
- remove project id from the s3 lists items
-  check the images in s3 buckets
- S3_ENDPOINT fallback in .env.example
- missing S3_ENDPOINT in .env.example
- project image_url on project lists
- merge conflict with migrations file f87adf188a16
- remove image url from projects table & refractor upload file to s3 functions
- remove commented code
- chnages img_url to profile_img
- task splitter for small code
- merge small area aoi to near polygon
- **project-creation-key-parameters**: update min max value of altitude, image front and side overlap
- **project-creation-basic-info**: pass onchange and value of Controller to textarea as props
- **project-creation**: update endpoint
- upload project task boundaries
- **frontend**: single project details
- shift upload dem func  to project logic file
- comment the unsed var
- **pdm.lock**: slove merge conflict with main branch
- issues on read task endpoint
- issues request_mapping & update state
- update user profile dashboard
- issues slove in get project endpoint
- remove xxx_crud.py from all module
- refine the project get all
- issues slove in get project details
- issues slove in list tasks
- resolve the merge conflict with main
- task statistics endpoint
- remove pending task api endpoint
- upload project task boundaries
- no fly zone cliping isuues
-  get task waypoints
- fixes the task listing issues
- **frontend**: fixes task boundary api fail
- fixes the project creator issues
- reslove merge conflict with main
- rename functions name in pending tasks
- changes update to update_task_state
- import error from user_crud * user_routes
- added base class UserProfileIn & DbUserProfile
- drone schemas to delete drone
- log level using text level instead of number levels
- **backend**: attach lifespan to fastapi for startup events
- minio data volume name
- add env GOOGLE_LOGIN_REDIRECT_URI in .env.example
- removed `` typo from frontend/docker-entrypoint.sh
- frontend html copy to backend migrate from docker socket to docker volume
- typo
- **dashboard**: card UI
- **project-description**: increase text size of instruction
- source id/layer id duplication and layer removing issue on map rerender
- **project-dashboard**: hide map on project card
- **individual-project**: filter `UNLOCKED_TO_MAP` state on contributions task list
- correct the task area in km2
- update sql raw query in get single project info
- update sql raw query using distinct with order by created_at
- update sql raw query  based on project creator & drone operator
- **individual-project**: comment task filters
- **create-project**: error on project creation
- remove old raw sql query
- update sql raw query to update task status
- type issue on IRoute
- **login**: user profile blank issue while login using username password
- set requires_approval_from_manager_for_locking as optional in Pydantic model
- **task-description**: update endpoint
- **VectorLayerWithCluster**: disbale eslint
- remove unused raw sql query from get_tasks_by_user
- sql raw query & task approve status
- minio console accessible from internet
- crash issue on fileUpload component
- merge conflicts
- changes auto_lock_task to requires_approval_from_manager_for_locking
- merge conflict with migrations file 488158d3d5a8
- update finalout type as FinalOutput
- slove merge conflict with task_routes
- remove unused import
- **Project-creation**: restrict to proceed unless the project area and no-fly zone is added
- Resolve issues with access control and pending tasks retrieval for project creator
- **email-templates**: changes email format
- build issue
- frontend Dockerfile case FromAs
- docstring on function
- **hot-fix**:  listed pending task based on project creator
- issue on task status post
- index.html download always on restart & rm migration from entrypoint script
- map loading state delayed issue
- **create-project**: validate area before file upload
- disable consistent return
- **project**: deleted task event when project deleted
- merge conflict with main
- **backend**: raw sql project deletion using encode/databases
- **backend**: correctly init and close database in fastapi startup lifecycle
- added task rejected email
- type error in service of task states
- prefill user name while google login
- change dimension of square from meter to km
- **draw-tool**: cursor style
- Handle None values for  in project metadata
- no fly zones sent in task split post request and made optional
- change the placeholder in generate task section
- change the value of drawn area limit to 100km2
- linting issues
- enforce https callback url
- remove navbar until user fills the profile first
- temporarily remove publish option in create project section
- change label to metre in generate task section
- change the label of dimension to km
- add asterisk to required fields
- hide the add projects button when signedInAs drone operator
- merge conflict in pdm lock file
- reslove merge conflict on project schemas
- entrypoint use curl to donwload index.html
- frotnend tag
- use diff docker compsoe file
- compose on frontend entrypoint mnt
- docker-compsoe tag overrite $
- env on deploy
- **migration**: make executable
- remove unused import
- projects list endpoint
- user roles in user profile
- update user profile
- added  a param name on auth
- remove db port setup
- merge conflict
- clone with ref instead of ref_name
- clone stage
- user id check in update profile api
- precommit on main branch
- precommit
- precommit
- case insensative FS err: add src/frontend/src/assets/images/LandingPage/DTM-logo-red.svg
- case insensative FS err: delete src/frontend/src/assets/images/LandingPage/{DTM-logo-red.svg && dtm-logo-red.svg}
- update precommit to use ubuntu-latest
- bucket name for frontend to support CNAME
- Dockerized Frontend for Development environment
- linting errors
- Resolve merge conflicts in user modules
- Resolve merge conflicts in project and user modules
- resolve merge conflicts with pdm.lock
- Resolve AttributeError for 'generator' object lacking 'query' attribute
- doc string on Database connection
- Dockerized Frontend for LIVE Environment
- api path
- Frontend Dockerfile for volume issue in development env
- remove not needed os.environ() call for CORS config
- redirect URL on homepage
- routing for frontend with fallback
- login api issue
- login api issue

### Refactor

- **user-profile**: revalidate user details data on basic details patch success
- remove user data fetching on projects page
- remove cluster layers on map component unmount
- email template loading to follow DRY principle
- reset_password endpoint to improve exception handling
- email templates name for notification
- remove commented-out code
- remove commented-out code
- make isMapLoaded optional prop on baselayer switcher
- base layer switching logic
- remove sectiion from footer
- refactor form validations
- change form requirements
- remove unused sections in the landing page
- change the map center
- remove notification icon
- remove flight parameters column
- refractor task module using pyscopg and pydantic
- user schams & remove  fixme code
- Moved dependency functions to _crud.py & _deps.py
- Moved dependency functions to _deps.py and retained CRUD logic in _crud.py
- replace all refs to Database --> Connection (psycopg)
- rename outline_geojson & outline_no_fly_zones
- rename create_project route to POST on /projects
- update geojson parsing logic, add slugify to utils
- use psycopg connection pool
- **project-creartion**: move constant data to separate file
- change waypoint query key
- change type of api parameters
- **individual-project**: rename lock icon
- consolidate task comment creation into task events update endpoint
- user routes are kept in a single file
- remove role check for DRONE_PILOT from code
- **backend**: replace sqlalchemy db init entirely with encode/databases
- design of popUP in projects map section
- use getLocalStorageValue function in userProfile section
- modify the custom vector layer component to contain interactions
- change the variable name of projectArea
- update refs fmtm --> drone-tm
- revert and update migrations with '_at' for date columns
- design changes in login page
- change default route from / to /projects
- modify project card skeleton component for dynamic prop passing
- change `select` component according to design
