# Flying with DJI Fly

DJI Fly is the official app that comes with your drone, and is the default
way to load and fly a DroneTM flightplan.

Before you start, make sure you have completed the steps in
[Using DJI Drones With DroneTM](./overview.md).

## 1. Waypoints or Waylines?

- There are two modes of creating flightplans in DroneTM.
- The primary method is 'waypoints', where each point to take a photo
  is present, including the angle of the camera, altitude of the drone,
  etc.
- However, for tasks covering a large area, we have a large number of
  points generated. The RC2 controller (and low RC-N2 + low-spec devices)
  struggle to load all of the points, and may lag or fail to run the
  flightplan. **This is mostly a problem when the number of waypoints
  exceeds ~120**.
- As a solution to this, we have 'waylines' mode, which essentially removes
  all points between which the altitude does not vary significantly (>5m).
- For the majority of flyable tasks, you should now have an acceptable
  number of points to load in a single flight.

## 2. Loading A Flightplan

See [tutorial videos](https://drone.hotosm.org/tutorials) on the DroneTM platform!

!!! important

      Ensure the following for a successful flight:

      1. Before takeoff, the image settings are 4:3 and not 16:9.

      2. Also ensure you have set the max altitude the drone can fly in the
         settings to the maximum. This is required for terrain following
         to work, as it's the max altitude **above sea level**, not the
         max altitude above ground (so the drone can fly high enough).

      3. Ensure the max altitude setting on the drone is all the way to
         500m (the maximum) - they allows for terrain following to work
         correctly.

      4. If using wayline mode, ensure you set the **photo capture interval**
         on the drone to **2 seconds**. Hold the icon above the photo capture
         button, select the timer icon, scroll to 2 seconds, then click the
         photo capture button to start. **Ensure this is done as soon as the
         drone reaches the 2nd waypoint on the mission** (i.e. once it reaches
         the start of the photo capture grid, after the initial takeoff
         waypoint). Also ensure the photo capture is turned off when the final
         waypoint is captured for the mission. You must use 12MP JPEG to allow
         2 second photo interval.

         !!! note "Flight speed in waylines mode"

             The drone's flight speed in waylines mode is calculated from your
             **front overlap** setting and the 2-second photo interval, so that
             photos are spaced correctly along each strip. A higher front overlap
             means a lower flight speed. The controller will display this
             calculated speed when the mission is loaded - do not manually
             adjust it. If the speed looks unexpectedly high, check that the
             front overlap value in DroneTM is set correctly before downloading
             the flightplan.

      5. Do not interfere with the device mid-flight. Wait for the mission
         to finish before carrying out other operations on the controller.
