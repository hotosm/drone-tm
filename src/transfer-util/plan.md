# KMZ Transfer Utility Plan

## Context

Users generate drone waypoint missions (KMZ) from DroneTM web app or QField plugin, but **cannot reliably get them onto the DJI RC2 controller**. The current `dronetm-mobile` app uses SAF (Storage Access Framework) which is inherently fragile for MTP-connected devices -- it has null pointer bugs, loses permissions mid-transfer, and requires users to navigate a confusing directory picker. The manual MTP file manager workaround works (proving the hardware link is fine) but is a 12-step nightmare.

**Constraints:**

- DJI RC2 controller is locked down -- cannot sideload apps
- Phone ↔ Controller connected via USB cable (no WiFi/Bluetooth between them)
- Must work offline (rural Africa)
- Must work across many phone models (current app fails on various phones)

## Root Cause Analysis

The exploration of `dronetm-mobile` revealed why it's flaky:

1. Uses SAF (ContentResolver + DocumentFile) which is an abstraction over MTP -- fragile for USB devices
2. Has null-pointer crash bugs (e.g. `destFile!!.exists()` at `FileTransferHandler.kt:264`)
3. Doesn't handle permission loss during transfer
4. Relies on unreliable mount-point detection (`UsbDeviceUriResolver.kt`)
5. Detects MTP devices (`isMtpDevice()`) but never actually uses the detection
6. **Never uses Android's `android.mtp.MtpDevice` API** which is what working MTP file managers use

## Architecture: Multi-Strategy Transfer App

A **Flutter app on the phone** that supports multiple transfer strategies, trying the most reliable first and falling back gracefully. The app handles the full workflow: receive file (from QField, browser, file picker) → connect to controller → transfer to DJI waypoint directory.

### Transfer Strategies (in priority order)

```
┌────────────────────────────────────────────────────────┐
│                  DroneTM Transfer App                   │
│                    (on phone)                           │
│                                                        │
│  Input:  QField intent / deeplink / file picker        │
│                                                        │
│  Strategy 1: Direct MTP (android.mtp.MtpDevice API)   │
│    → Programmatic navigation, no picker needed         │
│    → Same approach as working MTP file managers        │
│                                                        │
│  Strategy 2: SAF (improved, persistent permissions)    │
│    → User navigates directory ONCE, permission cached  │
│    → Fallback when MTP API unavailable                 │
│                                                        │
│  Strategy 3: HTTP over USB tethering                   │
│    → For future controller-side app, or other devices  │
│    → Phone enables tethering, POSTs to controller IP   │
│                                                        │
│  Strategy 4: HTTP over WiFi/network                    │
│    → For any networked setup (hotspot, shared WiFi)    │
│    → Same HTTP endpoint, different transport           │
│                                                        │
│  Output: KMZ written to controller at                  │
│  /Android/data/dji.go.v5/files/waypoint/{uuid}/{uuid}.kmz │
└────────────────────────────────────────────────────────┘
```

### Strategy 1: Direct MTP via `android.mtp.MtpDevice` API (PRIMARY)

This is the key improvement. Android provides `android.mtp.MtpDevice` for direct MTP protocol communication -- the same API that working MTP file manager apps use. Unlike SAF, it:

- Communicates directly with the USB device at the protocol level
- Navigates the filesystem programmatically (no directory picker)
- Doesn't depend on ContentResolver permission scoping
- Can retry at the protocol level on transient failures

**How it works:**

1. Detect DJI RC2 via `UsbManager` (vendor 11427, product 4129 from `device_filter.xml`)
2. Request USB permission via `UsbManager.requestPermission()`
3. Open as `MtpDevice(usbDevice)`
4. Get storage IDs via `getStorageIds()`
5. Navigate object tree: root → `Android` → `data` → `dji.go.v5` → `files` → `waypoint` → `{uuid}/`
6. Find existing KMZ, delete it via `deleteObject()`
7. Send new KMZ via `sendObjectInfo()` + `sendObject()`
8. Close device

**Implementation:** Kotlin platform channel in Flutter wrapping `android.mtp.MtpDevice`. ~200 lines of Kotlin + ~50 lines Dart.

**Risk:** `MtpDevice.sendObject()` has quirks on some Android versions. Mitigation: fall back to Strategy 2.

### Strategy 2: Improved SAF (FALLBACK)

Fix all the bugs in the current SAF approach and make it a reliable fallback:

1. **Persist URI permissions** -- user navigates to DJI directory ONCE, URI saved permanently via `takePersistableUriPermission()`. All future transfers skip the picker.
2. **Fix null-safety crashes** -- replace `destFile!!.exists()` with safe calls
3. **Pre-navigate picker** -- build initial URI pointing to controller's root, not phone storage
4. **Timeout handling** -- detect stalled transfers and retry
5. **Clear step-by-step guide** -- show the user exactly which folders to tap (with screenshots/names)

### Strategy 3: HTTP over USB Tethering (FUTURE/ALTERNATIVE)

If the controller ever allows app installation, or for other controller types:

1. Phone enables USB tethering (one toggle)
2. Creates TCP/IP network over USB cable
3. Controller app runs HTTP server on port 8741
4. Phone POSTs KMZ to controller IP

Also useful for **non-DJI controllers** or **custom Android controllers** where apps CAN be sideloaded.

### Strategy 4: HTTP over WiFi/Network

For setups where devices share a network (hotspot, shared WiFi, etc.):

- Same HTTP protocol as Strategy 3
- Works with any networked receiver
- Also enables the DroneTM web app to send directly

## App Input Methods

The app accepts KMZ files from multiple sources:

| Source                 | Mechanism                                       | Notes                                               |
| ---------------------- | ----------------------------------------------- | --------------------------------------------------- |
| **QField plugin**      | Android Share intent                            | QField shares file → our app appears in share sheet |
| **QField plugin**      | Custom deeplink `dronetm://transfer?file={uri}` | Direct trigger from plugin                          |
| **DroneTM web app**    | Download + share                                | User downloads KMZ, shares to our app               |
| **File manager**       | Share intent / file open                        | Any `.kmz` file → our app                           |
| **In-app file picker** | Manual selection                                | User browses for downloaded KMZ                     |

## Project Structure

```
src/transfer-util/
├── lib/
│   ├── main.dart                        # Entry point, strategy selection
│   ├── models/
│   │   └── waypoint_mission.dart        # UUID + metadata
│   ├── services/
│   │   ├── transfer_strategy.dart       # Abstract strategy interface
│   │   ├── mtp_transfer.dart            # Strategy 1: MtpDevice wrapper (calls platform channel)
│   │   ├── saf_transfer.dart            # Strategy 2: SAF with persistent permissions
│   │   ├── http_transfer.dart           # Strategy 3+4: HTTP client for network transfers
│   │   └── connection_detector.dart     # Detect USB device, tethering, WiFi
│   ├── screens/
│   │   ├── home_screen.dart             # Main UI: status, file selection, transfer
│   │   ├── strategy_screen.dart         # Manual strategy selection if auto-detect fails
│   │   └── setup_screen.dart            # First-time: permissions, instructions
│   └── platform/
│       └── mtp_channel.dart             # Dart side of platform channel
├── android/
│   └── app/src/main/
│       ├── AndroidManifest.xml          # USB host, storage permissions, intent filters
│       ├── kotlin/.../
│       │   ├── MtpTransferPlugin.kt     # Platform channel: MtpDevice API wrapper
│       │   └── UsbDeviceDetector.kt     # USB device detection + filtering
│       └── res/xml/
│           └── device_filter.xml        # DJI RC2 USB identifiers
├── pubspec.yaml
└── test/
```

## Android Manifest

```xml
<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-feature android:name="android.hardware.usb.host" android:required="true" />

<activity android:name=".MainActivity">
  <!-- USB device attached -->
  <intent-filter>
    <action android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED" />
  </intent-filter>
  <meta-data android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED"
             android:resource="@xml/device_filter" />

  <!-- Share intent for KMZ files -->
  <intent-filter>
    <action android:name="android.intent.action.SEND" />
    <category android:name="android.intent.category.DEFAULT" />
    <data android:mimeType="application/vnd.google-earth.kmz" />
    <data android:mimeType="application/octet-stream" />
  </intent-filter>

  <!-- Custom deeplink -->
  <intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <data android:scheme="dronetm" android:host="transfer" />
  </intent-filter>
</activity>
```

## Platform Channel: MTP Transfer (Kotlin)

The core native code wrapping `android.mtp.MtpDevice`:

```kotlin
// MtpTransferPlugin.kt - Key operations
class MtpTransferPlugin : FlutterPlugin, MethodCallHandler {

    fun listMissions(device: MtpDevice): List<Mission> {
        // Navigate: root → Android → data → dji.go.v5 → files → waypoint
        // List UUID subdirectories
        // Return [{uuid, lastModified}]
    }

    fun transferKmz(device: MtpDevice, uuid: String, kmzBytes: ByteArray): Boolean {
        // Navigate to waypoint/{uuid}/
        // Delete existing {uuid}.kmz if present
        // sendObjectInfo() + sendObject() with new KMZ
        // Return success/failure
    }
}
```

## QField Plugin Integration

Add to `src/qfield-plugin/main.qml` (~40 lines):

```javascript
function sendViaTransferApp(kmzData) {
  // Option A: Android intent (share the KMZ file)
  // Option B: If controller IP known, direct HTTP POST
  Qt.openUrlExternally("dronetm://transfer?file=" + encodeURIComponent(kmzFilePath));
}
```

Add to `FlightplanDialog.qml` (~20 lines):

- "Send to Controller" button (appears after generation)
- Triggers the transfer app via intent/deeplink

## DroneTM Web App Integration

New `src/frontend/src/utils/wifi-transfer.ts` (~30 lines):

```typescript
export async function sendKmzViaHttp(ip: string, port: number, blob: Blob, uuid?: string) {
  const formData = new FormData();
  formData.append("file", blob, "mission.kmz");
  if (uuid) formData.append("uuid", uuid);
  const res = await fetch(`http://${ip}:${port}/upload`, { method: "POST", body: formData });
  if (!res.ok) throw new Error(`Transfer failed: ${res.statusText}`);
}
```

## "Must Have Prior Mission" Constraint

DJI stores mission records in a sandboxed database. Can only REPLACE existing KMZ files:

1. App scans for existing UUID directories
2. Shows list of available mission slots (sorted by recency)
3. Auto-selects most recent mission
4. Clear first-time message: "Create one test waypoint mission in DJI Fly first"

## Implementation Phases

### Phase 1: MTP Transfer Core

- Flutter project scaffolding at `src/transfer-util/`
- Kotlin platform channel wrapping `android.mtp.MtpDevice`
- USB device detection for DJI RC2
- Mission listing (scan UUID directories)
- KMZ write (delete + send)
- Basic UI: device status, mission list, file picker, transfer button

### Phase 2: Input Handlers

- Android Share intent receiver (`.kmz` files)
- Custom deeplink handler (`dronetm://transfer`)
- In-app file picker for manual selection

### Phase 3: SAF Fallback

- Improved SAF with persistent URI permissions
- One-time directory navigation with clear guidance
- Auto-fallback when MTP strategy fails

### Phase 4: QField + Web Integration

- QField plugin: "Send to Controller" button + deeplink trigger
- DroneTM web: HTTP transfer option alongside WebUSB/ADB

### Phase 5: Network Strategies

- HTTP transfer client (for USB tethering and WiFi scenarios)
- Connection detection (USB tethering, WiFi, etc.)
- Auto-strategy selection based on available connections

## Replaces `dronetm-mobile`

The existing `dronetm-mobile/` Kotlin app is deprecated entirely. The new app addresses every failure mode:

- **Crash on null pointer** → Safe Kotlin + Dart null handling
- **SAF directory navigation confusion** → MTP API navigates programmatically
- **Permission loss mid-transfer** → MTP keeps USB connection open
- **Unreliable mount point detection** → Direct USB device API
- **No fallback** → Multiple strategies with graceful degradation

## Risks

| Risk                                                       | Likelihood | Mitigation                                                                           |
| ---------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `MtpDevice.sendObject()` quirky on some Android versions   | Medium     | Fall back to SAF strategy; test on multiple phones                                   |
| Some phones don't support USB Host / MTP Host mode         | Low        | SAF fallback still works; most modern phones support USB Host                        |
| MTP write access to `/Android/data/` blocked on controller | Medium     | Manual MTP managers can do it (proven), so API should too. If blocked, SAF fallback. |
| QML deeplink/intent support limited                        | Low        | QField can share files via standard Android share; intent is the backup              |
| Flutter MTP platform channel complexity                    | Medium     | Well-documented Android API; ~200 lines of Kotlin                                    |

## Verification

1. Build and install on test phone with DJI RC2 connected via USB
2. Verify MTP strategy: auto-detect controller → list missions → transfer KMZ → confirm in DJI Fly
3. Verify SAF fallback: disable MTP → SAF picker opens → persist permission → transfer works on retry
4. Verify share intent: share KMZ from file manager → app opens → transfer succeeds
5. Verify QField deeplink: generate flightplan in QField → "Send to Controller" → app opens → transfer
6. Test on 3+ phone models to verify cross-device reliability
7. Test with no internet (airplane mode) to verify offline operation

---

Phase 1 Complete: Transfer Utility Scaffolding

src/transfer-util/ -- Flutter app with MTP transfer core (~1,200 lines across 7 source files)

Files created:

Android native (Kotlin):

- MtpTransferPlugin.kt (386 lines) -- Core MTP platform channel using android.mtp.MtpDevice API:
  - USB device detection (DJI vendor ID 11427)
  - MTP device open/close
  - Navigates Android/data/dji.go.v5/files/waypoint/ programmatically
  - Lists mission UUID directories
  - Deletes old KMZ + sends new KMZ via sendObjectInfo()/sendObject()
  - Event stream for USB attach/detach/permission events
- MainActivity.kt (56 lines) -- Handles USB, share intents, and deeplinks
- device_filter.xml -- DJI USB device identifiers
- AndroidManifest.xml -- Permissions (USB host, storage), intent filters (share, deeplink dronetm://transfer, .kmz files)

Dart:

- mtp_channel.dart (125 lines) -- Platform channel wrapper with typed models
- transfer_service.dart (222 lines) -- State management orchestrating the full flow
- home_screen.dart (350 lines) -- Material 3 UI with device list, file picker, mission selector, transfer button
- waypoint_mission.dart (44 lines) -- Models and enums
- main.dart (34 lines) -- App entry with HOT red theme

App ID: org.hotosm.drone_tm

What's ready to test:

1. Connect phone to DJI RC2 via USB
2. App auto-detects controller
3. One tap to grant USB permission
4. Scans missions automatically (no directory picker needed!)
5. Pick a KMZ file or share from QField
6. One tap to transfer

Next phases (not yet built):

- Phase 2: Share intent / deeplink handlers are wired in the manifest but need end-to-end testing
- Phase 3: SAF fallback strategy
- Phase 4: QField plugin integration + DroneTM web integration
- Phase 5: HTTP transfer for network scenarios

---

How the fallback works:

1. App tries MTP first (primary strategy)
2. If MTP fails at any step, it switches to SAF mode with a clear message
3. In SAF mode, the user picks the waypoint directory ONCE -- permission is persisted in SharedPreferences
4. Subsequent transfers skip the picker entirely
5. User can manually switch between modes via the strategy indicator bar
