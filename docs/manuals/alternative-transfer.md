# Alternate Flightplan Transfer Methods

Sometimes the typical approaches to transfer the flightplan file to the
drone don't work well.

There may be specific workarounds for your phone models or region you
are working in.

## Transfer from phones via an MTP app (when DroneTM transfer doesn't work)

Some phones can see the Katmai controller using some kind of MTP app, but can’t run the DroneTM APK mobile app (it crashes on launch).

In this case, there’s a horrible workaround to transfer the file using the MTP file manager.

We've found these in the wild in Zambia with a team including members from Zimbabwe, South Africa, and Malawi.

- Open browser on phone, go to [drone.hotosm.org](http://drone.hotosm.org), hit the round target "location" button.
  - You may need to give permission to the website to use location
- Using the blue location dot as a guide, walk to a nice takeoff point within the task area
- Push the "Change Take off Point" button
  - Select "My current location" and save the result
- Download the task (make sure you’ve got the right drone selected; eg the Mini 5 Pro).
  - Take note of where the flight plan has been saved
- Plug the controller into the phone using a USB-C cable. Swipe down from the top of the screen to see notifications.
  - If you have the kind of phone that does this, you’ll see message saying "Connected to KATMAI -IDP \_SN…" and "Tap to view files." Tap.
- It’ll now offer you "Choose an app for the USB device." If you choose DroneTM and it works, good for you!!!
  - If you choose DroneTM and it immediately crashes, read on, here’s how you can manually transfer the file:
  - Choose MTP Host (probably "just once" in case we get the DroneTM app working again)
- You’ll now be in a kind of file manager, probably at the root of the controller file system. Click your way into Android -> data -> dji.go.v5 -> files -> waypoint. In waypoint will be another folder with a UUID (long string of random letters and numbers) for a name. Click into that folder.
- You should now see the existing waypoint file, a KMZ with with the exact same UUID name as the folder it’s in. Click and hold that file to select it, then click the 3-dot menu button on the upper right. Choose "Get info". You should now see the entire filename, including the .kmz extension.
- Long-press on the filename to select all of it except the ".kmz" part. Press "copy".
- Now go back to your file manager, where you have the downloaded flight plan! Click the menu button beside it and select "rename." Now delete the original name and paste in the UUID filename you just copied (the reason we had to do that in the file manager is that the stupid MTP app doesn’t have a "rename" option!)
- Go back to the MTP app, select the waypoint file and delete it.
  Press the top left menu, and choose the phone (not the KATMAI) to look for the new waypoint file. Navigate to the folder containing the new waypoint file that you just renamed, and select "copy to".
  Select the upper left menu again, select the KATMAI, navigate to the waypoint folder again as above, and press "copy".
- Open your waypoint file on your controller and see if it’s correct!
