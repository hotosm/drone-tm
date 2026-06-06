# Getting flightplans from QField onto the drone controller

## Context

After the QField plugin (see [ADR 0004](0004-mobile-qfield-plugin.md))
generates a flightplan, the file has to land in a specific directory on the
drone controller for the manufacturer's app to pick it up:

- DJI: `Android/data/dji.go.v5/files/waypoint/<uuid>/<uuid>.kmz`
- Potensic Atom 2: `Android/data/com.ipotensic.atom/files/Waypoint/<mission-id>/`

The original plugin tried to do this transparently with a "Copy to Flight
Controller" button that scanned `/sdcard`, `/storage/usbotg`, and
`/mnt/media_rw/usbotg` for the manufacturer's waypoint directory and wrote
into it directly. In practice this never worked outside of running QField
on the controller itself, and it's worth writing down why so we don't
re-introduce it.

## Why the direct-copy approach was removed

The common field setup is QField on the operator's phone, with the DJI
controller plugged into the phone over USB. Android exposes the controller
through **MTP**, not as a mounted filesystem - so it has no path under
`/storage`, `/sdcard`, or `/mnt`, and `XMLHttpRequest("GET", "file://...")`
can't see it. This isn't a permissions issue; MTP is a protocol, and even
with root the host phone has no mount to write through.

The only standard Android mechanism for writing to an MTP-attached device
is the **Storage Access Framework** (SAF) - the system file picker - via
`content://` URIs and `DocumentFile`. That's also why QField's existing
"Save to Device" button can reach the controller: it goes through
`platformUtilities.exportDatasetTo()`, which fires the SAF picker.

The same restriction bites even when QField is on the controller itself
(phone-as-controller setup): since [Android 11's scoped storage
changes](https://developer.android.com/about/versions/11/privacy/storage#file-access),
apps can't write directly into other apps' `Android/data/<pkg>/` dirs
without going through SAF, so a plain file copy from QField to the DJI
app's waypoint directory is blocked on a single device too.

## What we settled on

Save via the SAF picker, with the plugin doing as much of the fiddly
bookkeeping as possible so the operator only has to navigate:

- **One-time UUID capture.** The operator opens the DJI controller's
  waypoint directory once in a file manager, copies the random folder
  name (the per-controller UUID), and pastes it into a "DJI Mission ID"
  field in the plugin dialog. The value is persisted as a project
  variable (`dtm_dji_mission_id`), so it survives QField restarts and is
  pre-filled next time.
- **Auto-named save.** With a UUID present, the Save button becomes
  "Save as DJI Mission" and the KMZ is renamed to `<uuid>.kmz` before the
  SAF picker is opened. The operator just navigates to the matching folder
  and saves; no rename step.
- **Handholding when the picker is open.** Just before launching the
  picker we (a) copy the UUID to the clipboard so the operator can paste
  it into the picker's search/filename box, (b) write a result message
  containing the UUID and full target path, and (c) toast "Save into the
  waypoint folder named &lt;UUID&gt;". The post-save help label in the dialog
  interpolates the actual UUID into the step list so the operator can
  re-check it after the picker closes.

Potensic uses the same SAF path via `platformUtilities.exportFolderTo()` for
the mission folder, with a ZIP fallback. No equivalent UUID flow yet -
Potensic mission directories are timestamps the user already controls.

For the phone-as-controller case (where SAF won't let you write into
`Android/data/...` directly), the Files app split-window drag-and-drop
trick is the known workaround: open Files, "New window" from the 3-dot
menu, split-screen the two windows, drag the saved KMZ from Downloads
into the DJI waypoint dir.

## Alternatives considered (and not chosen now)

- **Copy from a laptop.** Connect the controller to a laptop and drag the
  KMZ in, or use the existing WebADB push from the DroneTM web app. Works
  reliably from Windows (MTP is built in). On macOS it needs Android File
  Transfer, which is flaky and effectively abandoned; on Linux it depends
  on `gvfs-mtp` / `jmtpfs` and tends to vary by distro. Either way it's a
  perfectly good fallback, but it means carrying a laptop, which is what
  ADR 0004 was trying to avoid.
- **Phone-side note.** Most modern Android phones have a built-in MTP
  handler that exposes the controller through the SAF picker without any
  extra app. In the field we've hit a couple of phones where the system
  handler doesn't surface the device; installing a third-party MTP app
  (e.g. MiXplorer, USB OTG File Manager) gets it visible again. The
  full manual sequence is written up at
  [docs.drone.hotosm.org/manuals/alternative-transfer/](https://docs.drone.hotosm.org/manuals/alternative-transfer/).
- **WebADB push from the DroneTM web app** (`src/frontend/src/utils/adb.ts`).
  Works for Potensic today; the DJI path is implemented but not yet
  validated on hardware. Needs internet, Chromium-based browser, USB
  debugging enabled on the phone, and for DJI a debuggable build of the
  DJI Go app - all of which limit it to advanced/connected users.
- **A small companion app.** A single-purpose app that holds a persisted
  SAF tree URI for the controller's waypoint directory and writes
  flightplans into it without re-prompting. A Kotlin proof-of-concept
  already exists at
  [naxa-developers/dronetm-mobile](https://github.com/naxa-developers/dronetm-mobile)
  (uses `ACTION_OPEN_DOCUMENT_TREE` + `DocumentFile`, auto-navigates to
  the DJI waypoint dir, renames on copy). A production version would
  more likely be Flutter for iOS + Android coverage. We're holding off
  until the SAF flow shows itself to be insufficient in the field - a
  second app reintroduces some of the mobile-app maintenance cost ADR
  0004 chose to avoid.

## Consequences

- No more silent "controller not found" failures - the plugin no longer
  pretends it can write directly.
- Save to Device is the only transfer button, which makes the UI obvious.
- The operator has to look up the controller UUID once. After that it's
  remembered per project.
- We carry less code: roughly 190 lines of broken path-scanning and
  directory-listing logic gone from `main.qml`, plus the dialog's Copy /
  Retry buttons and the `transfer_failed` state.
- If field use shows the SAF picker is still too fiddly, the Flutter
  companion app is the next step.
