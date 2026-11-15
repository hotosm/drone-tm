# Potensic Atom 2

- Ensure you have Potensic Eve installed (standard version).
- Create one waypoint mission manually using the app, then **save**.
- Download your waypoint mission zip file from DroneTM.
- Connect your phone to a computer and navigate to:
  `/sdcard/Android/data/com.ipotensic.atom/files/Waypoint/`.
- See a single directory that was created for the test flight
  above.
- Enter the directory and replace the **two** `.json` files with
  those inside your downloaded mission zip file.
- **Make sure to rename** the copied `.json` file to match
  the filename of the file already on your phone.
- Load Potensic Eve & the waypoint mission should be selectable
  to fly.

## Flying on iOS (Potensic Eve)

Eve on iOS reads a different waypoint file from the one DroneTM exports.
An unofficial, free converter turns a DroneTM Atom 2 flight plan into a
`waypoints.json` that Eve accepts: [DroneTM to Eve Converter](https://github.com/narendtt/DroneTM-to-Eve)

Summary of the process:
1. Create the flight plan in DroneTM and download the JSON.
2. Create a dummy waypoint mission in Eve so it makes a `waypoints.json`.
3. Use Apple Devices to copy the `TrajectoryFlight` folder to your computer.
4. Convert the plan with the tool and replace the dummy `waypoints.json`.
5. Copy the folder back to Potensic Eve in Apple Devices.

The converter is not affiliated with Potensic or HOT. Check the mission
in Eve before flying.

## Before Flying

Set these in Potensic Eve, alongside the
[Flight Checklists](../flight-checklists.md):

- **Activate the drone.** Unactivated, it is limited to 30 m
  height and distance.
- **Turn Beginner Mode off** (Settings > Safety). It keeps the
  drone within 30 m, so the mission cannot fly.
- **Virtual Fence** (Settings > Safety): allow the plan's highest
  point and furthest distance. Height is measured from the
  take-off point, and the manual gives 120 m as the maximum.
- **Return altitude:** above nearby obstacles. The Atom 2 has no
  obstacle avoidance.
- **Camera:** JPG (not JPG+RAW), 4:3, and zoom at 1x.
- **SD card:** required. Photos are only stored on the card.

The mission takes a photo at each waypoint, so there is no need
to start or stop capture by hand.
