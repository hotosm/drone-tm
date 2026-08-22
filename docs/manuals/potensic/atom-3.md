# Potensic Atom 3

Atom 3 mission transfer uses the same replacement workflow as Atom 2:

1. Ensure you have Potensic Eve installed.
2. Create and save one disposable waypoint mission in the app.
3. Download the Atom 3 waypoint ZIP from DroneTM, or generate the mission
   offline with the DroneTM QField plugin.
4. Connect the phone or PTD2 controller to a computer and navigate to
   `/sdcard/Android/data/com.ipotensic.atom/files/Waypoint/`.
5. Open the directory for the disposable mission and replace its
   `global.json` and timestamp-named mission JSON with the two files from the
   DroneTM ZIP.
6. Rename the copied mission JSON to match the timestamp filename that was
   already in the directory.
7. Reopen the saved mission in Potensic Eve and check its route, height,
   gimbal angle, speed, and finish action before considering takeoff.
