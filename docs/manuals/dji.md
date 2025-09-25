# Using DJI Drones With DroneTM

## 1. Initialise The Drone

- As soon as you remove the drone from the packaging, mark the drone,
  controller, and all batteries with a permanent marker to identify
  them as a set.
- Ensure the foam insert it removed from behind the gimbal (camera),
  so that it can move freely.
- Power on your drone, connect to Wifi, and log into your DJI account.
  Without this step, the image timestamps will be incorrect and not
  correctly synced with the current time and timezone.
- If you are using an RC2 or controller model with an in-built screen,
  next insert your SD card into the controller, then go to
  Profile --> Settings --> Storage. Click 'SD Card' to swap to using the
  SD card to load waypoint missions from.
- Next, switch to image mode (instead of video mode), then go to the image
  settings, and select 4:3 as the aspect ratio.
  (we don't want 16:9 as it's cropped / mainly for video).
- To be able to load flightplans from DroneTM onto your controller / phone,
  first you must fly at least one 'waypoint mission' via DJI Fly.
- Connect to your drone. While it's hovering, select 'Waypoint' mode.
  Create a minimum of two waypoints by clicking the C1 button.
- Exit and land the drone - this part is done.

## 2. Waypoints or Waylines?

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

## 3. Loading A Flightplan

See [tutorial videos](https://dronetm.org/tutorials) on the DroneTM platform!

!!! important

      Ensure the following for a successful flight:

      1. Before takeoff, the image settings are 4:3 and not 16:9.

      2. Ensure the max altitude setting on the drone is all the way to
         500m (the maximum) - they allows for terrain following to work
         correctly.

      3. If using wayline mode, ensure you set the **photo capture interval**
         on the drone to **2 seconds**. Hold the icon above the photo capture
         button, select the timer icon, scroll to 2 seconds, then click the
         photo capture button to start. **Ensure this is done as soon as the
         drone reaches the 2nd waypoint on the mission** (i.e. once it reaches
         the start of the photo capture grid, after the initial takeoff
         waypoint). Also ensure the photo capture is turned off when the final
         waypoint is captured for the mission.

      4. Do not iterfere with the device mid-flight. Wait for the mission
         to finish before carrying out other operations on the controller.
