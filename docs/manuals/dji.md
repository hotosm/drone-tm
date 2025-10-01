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
         waypoint is captured for the mission.

      5. Do not interfere with the device mid-flight. Wait for the mission
         to finish before carrying out other operations on the controller.

### Helpful Tips

#### Q: My drone is asking me to log in

- DJI is quite restrictive and requires all drones to be logged in to fly.
- Sometimes a firmware update may require you to login again.
- Ensure you are connected to Wifi: pull down the top bar on the screen
  --> toggle Wifi --> connect to your network.
- Enter your DJI login credentials (created on the DJI website).

#### Q: I can't connect the mobile app on my phone to the controller

- Make sure you enable '**Transfer mode**' once the cables are plugged
  in. By default it will often start in 'Charging mode', but you
  need to pull down the notifications bar and click the popup there
  to toggle connection mode.
- USB C cables can be difficult sometimes. Try swapping the direction
  of the cable. Try another cable too. Ideally you should use the
  USB C cable that was packaged with the drone.
- Try a different phone if possible too, to help confirm where the
  issue may be.

#### Q: The dates on my final imagery files are wrong

- If the drone has not connected to Wifi for a while, the
  clock inside the drone may be out of date. Connect to
  Wifi to fix this problem.
