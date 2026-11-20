# ArduPilot SITL

A simulated ArduCopter quad (~7MB image) for testing Drone-TM flight plans
without a drone, and how to check Tri-Cam plans without a Tri-Cam.

## Automated tests

```bash
just test sitl
```

Runs in containers (about 30s) and checks a generated Tri-Cam plan:

- passes the Tri-Cam validator, `tricam_plan_check.py` from the
  [Tri-Cam releases repo](https://github.com/mrkensan/x500-tri-cam-releases)
  (pinned in `tests/test_mission.py`). It checks the same rules as the
  Plan Loader that blocks arming on the flight controller.
- uploads to ArduCopter, flies in AUTO and runs every item (none skipped),
  then lands.

## Manual test in QGroundControl

Watch a plan fly end to end. SITL has no Plan Loader, so it arms without a
Tri-Cam.

1. **Generate a plan**, either by downloading a TRICAM flight plan from a
   local Drone-TM, or from `src/backend/packages/drone-flightplan` with:

   ```bash
   uv run flightplan --project_geojson aoi.geojson --gsd 2 --drone_type TRICAM \
     --use_centroid_as_take_off_point --outfile tricam-test.plan
   ```

2. **Start SITL at the plan's takeoff point:**

   ```bash
   python3 -c "import json; h = json.load(open('tricam-test.plan'))['mission']['plannedHomePosition']; print(f'{h[0]},{h[1]},0,0')"

   docker run --rm -t -p 5760:5760 ghcr.io/hotosm/drone-tm/ardupilot-sitl:4.7.3 \
     --home <output> --speedup 5
   ```

3. **Connect QGC** via **Application Settings → Comm Links → Add → TCP**,
   `127.0.0.1:5760` (`localhost` doesn't seem to work well). Wait for
   **Ready To Fly** about 30s.

4. **Fly.** Set `AUTO_OPTIONS = 3` in **Parameters** (SITL has no RC
   sticks), open and **Upload** the plan, then set mode **Auto** and **Arm**.
   Check it spins once at the first line start, each line is bracketed by
   #2500/#2501, then #532, RTL and landing.

Notes:

- SITL exits when QGC disconnects, and parameters reset on every run.
- To keep flight logs, add `-v "$PWD/logs:/sitl/logs"`. Open the `.BIN` files
  in Mission Planner or https://plot.ardupilot.org.
- On Apple Silicon, add `--platform linux/amd64`.

## Flight controller without a Tri-Cam

Checks the real upload path and the real Plan Loader on hardware (e.g. a
Pixhawk 6X on USB, props off). With a Tri-Cam, its KB2040 installs the Plan
Loader itself. Without one, take it from the KB2040 firmware:

1. **Extract the Plan Loader** from a clone of the releases repo, and check
   the build, size and CRC match `kb2040/RELEASE_NOTES.md`:

   ```bash
   python3 extract_plan_loader.py \
     x500-tri-cam-releases/kb2040/releases/latest/tri_cam_kb2040.uf2 \
     tricam_plan_loader.lua
   ```

2. **Install it:** copy it to `APM/scripts/` on the SD card (or with QGC's
   MAVLink FTP), set `SCR_ENABLE = 1` and reboot.
3. **Upload a plan** in QGC. **Messages** should show
   `Tri-Cam not responding`, with no `PLAN ERROR` or `PLAN INVALID`.

Arming stays blocked, because ArduPilot doesn't let you skip the Plan
Loader's check (auxiliary authorisation). To watch the plan fly, use SITL
above. Delete the script afterwards so you can arm without a Tri-Cam.

## Build the image

The image wraps the official statically linked SITL binary. Other versions
are listed under `https://firmware.ardupilot.org/Copter/stable-<version>/`.

```bash
docker build --build-arg COPTER_VERSION=4.7.3 \
  -t ghcr.io/hotosm/drone-tm/ardupilot-sitl:4.7.3 .
```
