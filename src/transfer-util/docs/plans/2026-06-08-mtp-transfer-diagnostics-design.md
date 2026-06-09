# Field Diagnostics for the DroneTM Transfer App — Design

Date: 2026-06-08
Status: Accepted (implementation in progress)
App: `src/transfer-util/` (Flutter, branch `transfer-util-lib`)

## Problem

Flight-plan transfer is DroneTM's #1 field issue. The manual QField + file-manager
workaround succeeds on only ~1/3 of phones, and the new `MtpTransferPlugin`-based
transfer app is essentially **untested on real hardware** (a DJI RC2 + Mini 5 Pro is
now available for testing).

When a transfer fails in the field, the app surfaces a single generic error
(`NO_DEVICE`, `NO_PERMISSION`, `MTP_OPEN_FAILED`, `DIR_NOT_FOUND`, `SEND_FAILED`, …)
with **no field-collectable record of why**. Concretely, today we cannot tell apart:

- _no controller plugged in_ vs _the RC2 enumerated with an unexpected PID/interface
  class and our `getConnectedDevices` filter silently dropped it_ (both look like
  `NO_DEVICE`);
- _the user denied USB permission_ vs _the permission broadcast never arrived_ (the
  Android-14 `RECEIVER_EXPORTED` class of hang — both look like a 45 s timeout →
  `NO_PERMISSION`);
- _which path segment_ of `Android/data/dji.go.v5/files/waypoint/<uuid>` was missing
  when navigation failed (only `Log.d`'d — invisible without `adb`);
- the controller's MTP identity / storage layout (the `MtpDeviceInfo` we fetch in
  `openDevice` is currently discarded by the Dart layer).

Without this, "1/3 phones" is unactionable. The fix is **instrumentation**, not a new
transport: capture the raw USB/MTP facts and the per-step outcome, structure them, and
make the report exportable **offline** so a field tester can send it back.

## Goals

1. Turn every failed (or successful) transfer attempt into a structured, exportable
   report that pinpoints the failing step and the underlying device facts.
2. Provide a one-tap **standalone diagnostic scan** that characterises any phone + RC2
   combination **without needing a KMZ**.
3. Work fully offline (rural deployment): capture now, export/send later.
4. Add **zero new pub dependencies** (the app deliberately stays native-first; avoids a
   fragile `pub get`). Use Flutter built-ins + native platform channels only.

Non-goals: changing the transfer mechanism, NDK/libusb work, DJI-SDK integration,
backend report ingestion (the client queues POSTs; the receiver is out of scope here).

## Architecture

Three layers, mirroring the app's existing `native ↔ channel ↔ strategy ↔ controller ↔ UI`.

### 1. Native capture — `MtpTransferPlugin.kt` (method channel `org.hotosm.drone_tm/mtp`)

New read-only inspection methods (co-located with the USB/MTP code that owns
`UsbManager` and `currentMtpDevice`):

- `getEnvironment()` → `{ manufacturer, model, device, androidSdk, androidRelease,
hasUsbHostFeature, appVersion, appBuild, abi }`
- `dumpUsbDevices()` → list of **every** USB device, unfiltered:
  `{ deviceName, vendorId, productId, deviceClass, deviceSubclass, deviceProtocol,
manufacturerName, productName, serialNumber?, hasPermission, isDji, looksMtp,
interfaces: [{ id, interfaceClass, subclass, protocol, endpointCount }] }`
- `dumpMtpTree({ maxDepth=6, maxChildren=60 })` → requires an open device:
  `{ storages: [{ id, description, volumeIdentifier, freeSpaceBytes, maxCapacityBytes }],
deviceInfo: { manufacturer, model, serialNumber, version },
djiPath: { reachedDepth, deepestSegment, missingSegment, childrenAtFailure: [names] },
tree: { name, format, isDir, sizeBytes, children: [...] } }` (tree bounded by
  depth/children; always includes the DJI-path traversal result even when the full
  walk is truncated).

`navigateToWaypointDir` is refactored to return the traversal context (deepest segment
reached, the missing segment, and the sibling names present where it stopped) so both
`dumpMtpTree` and the `DIR_NOT_FOUND` error can report _where_ it broke.

### 2. Native export — `DiagnosticsPlugin.kt` (method channel `org.hotosm.drone_tm/diag`)

- `getAppFilesDir()` → `context.filesDir.absolutePath` (for the Dart POST queue).
- `saveReportToDownloads({ fileName, content })` → writes via `MediaStore.Downloads`
  (API 29+) / `WRITE_EXTERNAL_STORAGE` fallback; returns the saved path/URI.
- `shareReport({ fileName, content })` → writes to cache, fires `ACTION_SEND` with a
  `FileProvider` content URI (`text/plain`), returns `true` on launch.

Manifest: add `INTERNET`, a `FileProvider` (authority `org.hotosm.drone_tm.fileprovider`)
and `res/xml/file_paths.xml`.

### 3. Dart — model, service, UI

- `models/diagnostic_report.dart`: `DiagnosticReport` (env, usbDevices, mtpTree, steps,
  summary, appContext, timestamp) + `DiagnosticStep` (`name, status[ok|fail|timeout|info],
code?, detail?, durationMs?`). `toJson()` + `toText()` (human-readable) serialisers.
- `services/diagnostics_service.dart`:
  - `DiagnosticLog` — an always-on `ChangeNotifier` ring buffer of recent `DiagnosticStep`s,
    written to from the transfer flow; survives screen navigation.
  - `runFullScan()` — env → USB dump → (DJI/MTP present?) → permission → open → tree dump
    → close, recording each step; returns a `DiagnosticReport`.
  - `buildReport()` — assemble env + last USB dump + last tree + current step log.
  - export: `share()`, `copyToClipboard()` (built-in `Clipboard`), `saveToDownloads()`,
    `enqueuePost()` + `flushQueue()` (disk-backed queue under `getAppFilesDir()`, sent via
    `dart:io HttpClient`; failures stay queued and are retried on next app start / scan).
- `platform/diag_channel.dart`: typed wrappers for both channels.
- `screens/diagnostics_screen.dart`: "Run full diagnostic scan" button, live step list
  (colour-coded), and an Export bottom sheet offering Share / Copy / Save / (queue) Send.
- Entry point: a `bug_report`/`troubleshoot` `IconButton` on `HomeScreen`'s `AppBar`;
  `DiagnosticsService` provided alongside `TransferController` in `main.dart`.

### Always-on logging hooks (minimal touches)

- `MtpTransferStrategy`: record `prepare`/`listMissions`/`transfer` start+outcome+duration;
  `_awaitPermissionDecision` distinguishes **granted / denied / timeout**.
- `TransferController`: record phase transitions and `_fail` (code + technical).
- `openDevice` result (`MtpDeviceInfo`) is captured into the log instead of being dropped.

## Report return paths (all selected; offline-first)

Capture writes to disk first; sending is best-effort and deferred:

1. **Share sheet** (native) — primary; send via WhatsApp/Telegram/email when signal returns.
2. **Copy to clipboard** (built-in) — paste into chat.
3. **Save to Downloads/DroneTM** (native MediaStore) — retrieve off the phone later.
4. **Auto-POST when online** — `dart:io HttpClient` to a configurable endpoint; queued on
   disk and flushed on success. No-op until an endpoint is configured / a receiver exists.

## Verification

- `flutter analyze` clean; `flutter build apk --debug` succeeds.
- Adversarial multi-dimension review (Kotlin/MTP-API correctness, Dart correctness,
  manifest/FileProvider, offline queue) before flashing to hardware.
- Field: install on the test phones, run the scan against the RC2, export a report, and
  confirm it pinpoints the step/cause on phones where transfer fails.
