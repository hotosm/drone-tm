# ArduPilot SITL

A simulated ArduCopter quad (~7MB image) for testing Drone-TM flight plans in
QGroundControl without a drone.

## Automated test

```bash
just test sitl
```

Uploads a generated Tri-Cam plan to SITL and checks ArduPilot stores every
item, with the header unchanged. Everything runs in containers.

## Manual test in QGroundControl

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

## Build the image

The image wraps the official statically linked SITL binary. Other versions
are listed under `https://firmware.ardupilot.org/Copter/stable-<version>/`.

```bash
docker build --build-arg COPTER_VERSION=4.7.3 \
  -t ghcr.io/hotosm/drone-tm/ardupilot-sitl:4.7.3 .
```
