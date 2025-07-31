# Reuse existing flightplan apps, by copying flightplan files to the correct directory

## Context and Problem Statement

- We have a good module for generating flightplans in a generic geojson format.
- Once we have a flightplan we need a way to send the flight instructions to drones.
- Manufacturers typically produce their own flying apps, such as DJI Fly, PotensicPro, etc.
- We have a tradeoff between the best user experience we can provide, with the maintainability
  of the approach going forward, considering our limited capacity within the tech team.
- As of 2025, we have 3 major drone manufactuers:
  - DJI
  - Parrot
  - Autel
  - Plus some smaller ones to consider, such as Potensic (cheap, good drones).

## Considered Options

### 1. Developing Our Own Flight App

**Approach**: probably build our flightplan generation directly into the app, then click generate & 'Go' to fly.

Develop a mobile application that can bundle the manufacturers SDK to fly drones directly.
Ideally we develop this cross-platform using Flutter, but it may complicate SDK usage.

👍 Pros

- Full control of user experience - very simple to use.
- Could implement full automation - click 'Go' and execute the flightplan without handholding.

👎 Cons

- High effort: SDK integration is non-trivial (especially DJI).
- Using Flutter (for both Android/iOS) may make SDK integration harder, needing
  [platform channels](https://docs.flutter.dev/platform-integration/platform-channels).
- The SDK releases for Android / iOS are inconsistent. For example DJI last updated its
  [iOS SDKs](https://github.com/dji-sdk/Mobile-SDK-iOS) 3yrs ago!
  The [Android SDK](https://github.com/dji-sdk/Mobile-SDK-Android-V5) is pretty up to date though.
- Maintenance cost is high (SDK updates, new device support, mobile developer).
- Risk of bricking or misflying drones: safety and liability considerations if we break them.
- SDK releases could be pulled at any point. DJI appear to be moving things to their cloud offering instead.

Variants:

- Full drone TM experience on mobile: swap the web-app for a full mobile experience.
- Hybrid (web-app + lightweight mobile app for flights), keeping the web-app for all drone-tm functionality,
  while having a very small mobile app that is a thin SDK wrapper.
  - Simply embed the SDKs, then have a few buttons: 'Load Waypoints', 'Fly'.
  - We would likely have these lightweight SDK wrappers developed as native apps, instead of Flutter, for easier SDK integration.

### 2. Integrating With Third Party Flight Apps

**Approach**: export flightplans to file format required for Litchi or other apps (e.g., KML, CSV, JSON), then import from their apps.

> Note, the key thing here is that we use **third-party** apps, not the official apps.

There are many options for third-party apps, with varying drone support.

These options are free to generate flightplans, but cost for the processing (we will use ODM, so this doesn't matter):

- Pix4D Capture - [supports most](https://www.pix4d.com/supported-drones)
  DJI, Parrot, Autel drones + others.
- DroneDeploy Flight App - supports a
  [good range](https://help.dronedeploy.com/hc/en-us/articles/1500004964842-Recommended-and-Supported-Drones#h_01FYYAWMZDW6VT5RBBCATGSW29)
  of DJI drones mostly + others.
- MapPilotPro from Maps Made Easy - [similar support](https://support.dronesmadeeasy.com/hc/en-us/articles/205704366-Supported-Hardware)
  to DroneDeploy above.

Litchi provides a good offering for a $25 lifetime license, [DJI drones only](https://flylitchi.com/help).

The nice thing about Litchi, is they are used pretty actively in the drone enthusiast community,
and seem to be well liked / keep their pricing model flat.

Two pipelines are available via QGIS plugins currently:

1. https://github.com/JMG30/flight_planner + https://github.com/pdfinn/flightplan2litchimission
2. https://github.com/OpenGeoOne/qgis-drone-flight-planner

Overall, it looks quite simple to dump a Litchi waypoint CSV (we could add this as an output option to drone-flightplan),
to then import into the Litchi mobile app.

👍 Pros

- No SDK integration and maintenance - we outsource the hard part (also no mobile app development needed).
- Uses existing, well-liked apps in the community. Good UX and testing already.
- Easy transition for users that already know the apps.
- They generally have Android + iOS versions of the app, but with different drone support (depending on SDK availability).

👎 Cons

- Depend on the app manufacturer to implement the SDK support - generally quick, but can vary.
- May lose some of the mission configuration options, depending on what is supported in the app.
- They may change the file format or import method, breaking our integration.
- The format used for waypoint missions inside the apps could also change, e.g. Litchi CSV
  format could change, breaking our integration temporarily.

**A second approach to this could be attempting to partner with an organization such as Litchi, for better
assurance of long term support and collaboration (perhaps also reduced license fees?)**

### 3. Using Official Flight Apps

**Approach**: use workarounds to import flightplans into official apps, while not officially supported.

> Note, the key thing here is that we use **official** apps for manufacturers, which are generally more locked down.

Generally these offerings are quite closed - offering no options for loading data via
mobile 'intent' or direct file imports.

Instead we need to create 'hack' workarounds:

- Generate our generic flightplan as geojson.
- Convert the flightplan to the specific format used by app, such as `.wmpl` KMZ file for DJI.
- Copy the file to the correct place on the filesystem, so it's picked up by the app.
- Open the app and run the flightplan.

👍 Pros

- Easy enough to extend to new drone brands, as long as we are able to reverse engineer their file format!
- No maintenance overhead integrating with SDKs, or mobile development required.
- Much easier to manage in a small team.

👎 Cons

- Slightly more 'fragile' over time:
  - Support for this could be blocked by manufacturers in various ways.
  - People with different drone firmware or mobile app versions may get different behaviour.
  - Would need to be tested frequently (could write a good suite of automated tests, to catch regressions early).
- Reduces the list of drones we can possibly support.
- Relies on multiple flying applications:
  - Not as much of an issue for operators - they generally only have one drone and one app.
  - But we need to document the approach to doing this for each manufacturer / app available.

This approach can be optimised further using WebADB/WebUSB pushing of the flightplans, reducing
the need for users to mess with copying a file directly onto their device storage location.

### 4. Reverse Engineering The Flight Protocols

- This one is a bit of a long-shot, but we could 'in theory' intercept the signals sent to the drones and reverse engineer them.
- Once a flightplan is loaded and executed in the drones memory, the actual flight is autonomous.
  - Sure, it's risky to not have real time feedback on the drones status.
  - We would basically have a set-and-forget approach, where we hope the flightplan succeeds and the drone returns!
- Practically, we would have a small mobile app to send a flightplan and execute the autonomous flight directly.
- Legalities around this a murky.

### 5. Manufacturing Our Own Drone

- This has been investigated as a possible option & may come to be in the future, as a longer term goal.
- Once we have a cheap drone specifically for community mapping applications, we could load ArduPilot.
- This gives us ultimate flexibility and user experience refinement, at the cost of:
  - Reduced accessibility if we don't have enough drones, but other options are readily available.
  - Can't use existing fleet of drones present in communities globally.

## Decision Outcome

**Short term**: 3, using official flight apps:

- We originally implemented this in the first iteration of DroneTM, as a simple start point.
- The approach has since been refined in a
  [PR to add WebADB pushing of files](https://github.com/hotosm/drone-tm/pull/570),
  to hopefully remove the manual process of file copying.
- Support for this will probably be maintained going forward, as it opens options
  for typically unsupported drones, such as the Potensic Atom series (not supported
  by third-party apps).

**Long term**: 2, integrate with third-party apps:

- This opens up the options for easier additional drone support, making maintenance easier.
- We will be assessing this option into the future to see the viability.
- We won't include this in the 'Consequences' section below, as it's still in a
  research phase.

### Consequences

- ✅ suits our small team and development capacity.
- ✅ integrates well with our existing web-app approach.
- ❌ user experience isn't as good as it could be.
- ❌ not quite as easy to add new drone support, as we need to do a lot of
  trial-and-error for the file format / apps.

We will revisit this strategy in future, and perhaps update in a new MADR document.
