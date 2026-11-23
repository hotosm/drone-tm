# ArduPilot SITL

A simulated ArduCopter quad (~7MB image) for testing Drone-TM flight plans
without a drone.

## Automated tests

```bash
just test sitl
```

Runs in containers. A generated plan for each MAVLink drone type uploads to
ArduCopter, flies in AUTO and runs every item (none skipped), then lands.

## Manual test in QGroundControl

Watch a plan fly end to end.

1. **Generate a plan**, either by downloading a QGROUNDCONTROL flight plan
   from a local Drone-TM, or from `src/backend/packages/drone-flightplan` with:

   ```bash
   uv run flightplan --project_geojson aoi.geojson --gsd 2 --drone_type QGROUNDCONTROL \
     --use_centroid_as_take_off_point --outfile test.plan
   ```

2. **Start SITL at the plan's takeoff point:**

   ```bash
   python3 -c "import json; h = json.load(open('test.plan'))['mission']['plannedHomePosition']; print(f'{h[0]},{h[1]},0,0')"

   docker run --rm -t -p 5760:5760 ghcr.io/hotosm/drone-tm/ardupilot-sitl:4.7.3 \
     --home <output> --speedup 5
   ```

3. **Connect QGC** via **Application Settings → Comm Links → Add → TCP**,
   `127.0.0.1:5760` (`localhost` doesn't seem to work well). Wait for
   **Ready To Fly** about 30s.

4. **Fly.** Set `AUTO_OPTIONS = 3` in **Parameters** (SITL has no RC
   sticks), open and **Upload** the plan, then set mode **Auto** and **Arm**.
   It should fly each line, then RTL and land.

Notes:

- SITL exits when QGC disconnects, and parameters reset on every run.
- To keep flight logs, add `-v "$PWD/logs:/sitl/logs"`. Open the `.BIN` files
  in Mission Planner or https://plot.ardupilot.org.
- On Apple Silicon, add `--platform linux/amd64`.

## Build the image

The image wraps the official statically linked SITL binary. Other versions
are listed under `https://firmware.ardupilot.org/Copter/stable-<version>/`.

```bash
docker build --build-arg COPTER_VERSION=4.7.3 \
  -t ghcr.io/hotosm/drone-tm/ardupilot-sitl:4.7.3 .
```
