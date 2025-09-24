# Using DJI Drones With DroneTM

## 1. Equipment

- Buy a DJI drone model such as **Mini 4 Pro** or **Mini 5 Pro**, plus a controller.
  - It is recommended to buy a controller model **without** an in-built screen,
    such as an RC-N2 (Mini 4 Pro) or RC-N3 (Mini 5 Pro).
  - Buying a controller with an in-built screen, such as RC-2, will present
    some limitations in future steps (DroneTM usage is no as seamless).
- Buy a fast SD card for photo capture, plus one extra SD card if using
  the RC2 controller or similar (built-in screen).
- If using a controller **without** an in-built screen, then your mobile
  device will be used as the screen / controller. For best user experience,
  ensure your device has **ADB** enabled (search how to do this for your model).

## 2. First Flight

- Power on your drone, connect to Wifi, and log into your DJI account.
  Without this step, the image timestamps will be incorrect and not
  correctly synced with the current time and timezone.
- If you are using an RC2 or controller model with an in-built screen,
  next insert your SD card into the controller, then go to
  Profile --> Settings --> Storage. Click 'SD Card' to swap to using the
  SD card to load waypoint missions from.
- Next, go to the image settings, and select 4:3 as the aspect ratio.
  (we don't want 16:9 as it's cropped / mainly for video).
- To be able to load flightplans from DroneTM onto your controller / phone,
  first you must fly at least one 'waypoint mission' via DJI Fly.
- Connect to your drone. While it's hovering, select 'Waypoint' mode.
  Create a few waypoints by clicking the C1 button.
- Exit and land the drone - this part is done.

## 3. Loading A Flightplan

See tutorial videos on the DroneTM platform!

<!-- prettier-ignore-start -->
| Controller | Web file copy | App file copy | Manual file copy |
|:------:|:-------:|:-------:|:--------|
| RC-2 | ❌ | ✅ | ✅ |
| RC-N2 | ✅ | ✅ | ✅ |
| RC-N3 | ✅ | ✅ | ✅ |
<!-- prettier-ignore-end -->

Ensure:

- You maintain good signal during flights by keeping line of sight,
  and pointing the controller antenae at the drone.
- Do not iterfere with the device mid-flight. Wait for the mission
  to finish before carrying out other operations on the controller.
