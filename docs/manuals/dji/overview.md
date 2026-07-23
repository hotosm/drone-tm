# Using DJI Drones With DroneTM

Which app you use to fly a DroneTM flightplan depends on your controller:

- **RC2 (or any controller with a built-in screen):** you must use
  [DJI Fly](./dji-fly.md). Litchi is not supported on these controllers.
- **RC-N1 / RC-N2 (uses your own phone as the screen):** you can choose
  between [DJI Fly](./dji-fly.md) and [Litchi](./litchi.md).

If you are unsure, use DJI Fly.

## Initialise The Drone

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

Once the drone is initialised, continue to the guide for your chosen app:
[Flying with DJI Fly](./dji-fly.md) or [Flying with Litchi](./litchi.md).

## Helpful Tips

### Q: My drone is asking me to log in

- DJI is quite restrictive and requires all drones to be logged in to fly.
- Sometimes a firmware update may require you to login again.
- Ensure you are connected to Wifi: pull down the top bar on the screen
  --> toggle Wifi --> connect to your network.
- Enter your DJI login credentials (created on the DJI website).

### Q: I can't connect the mobile app on my phone to the controller

- Make sure you enable '**Transfer mode**' once the cables are plugged
  in. By default it will often start in 'Charging mode', but you
  need to pull down the notifications bar and click the popup there
  to toggle connection mode.
- USB C cables can be difficult sometimes. Try swapping the direction
  of the cable. Try another cable too. Ideally you should use the
  USB C cable that was packaged with the drone.
- Try a different phone if possible too, to help confirm where the
  issue may be.

### Q: The dates on my final imagery files are wrong

- If the drone has not connected to Wifi for a while, the
  clock inside the drone may be out of date. Connect to
  Wifi to fix this problem.
