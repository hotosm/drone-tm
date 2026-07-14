# Building Custom Drones (For DroneTM)

Sometimes it may not be possible to buy a drone off the shelf
that is easily compatible with DroneTM.

A good example of this would be for thermal imagery projects.

In these cases, it may be preferable to assemble a custom
drone using standard quadcopter components.

## Overview

| Component                    | Role                                               |
| ---------------------------- | -------------------------------------------------- |
| **Pixhawk**                  | Flight controller (e.g. autopilot)                 |
| **QGroundControl**           | Ground control software used to plan/send missions |
| **DroneTM**                  | Generates the mission plan                         |
| **Companion Computer** (SBC) | Captures + geotags images                          |

The end result is an autonomous quadcopter running
PX4/MAVLink. Missions are generated in DroneTM, uploaded
via QGroundControl, and flown autonomously - no manual
piloting needed. A companion computer captures geotagged
images at each waypoint using a fixed camera mount for
nadir (straight-down) and/or 45° oblique shots.

This guide covers two build tiers. Both produce
orthomosaics usable for building mapping (e.g. digitising
an informal settlement). The high-end tier matches
DJI Mini 4 Pro image quality. See the
[Component List](#may-2026-component-list) for specific
parts and prices.

## Two Tiers

| Tier         | What you get                                                                                               | Est. total USD |
| ------------ | ---------------------------------------------------------------------------------------------------------- | -------------- |
| **Budget**   | Usable ortho for building footprint mapping. Some limitations - see below.                                 | ~$400-500      |
| **High-end** | DJI Mini 4 Pro equivalent image quality on a custom platform. Same workflow as any consumer mapping drone. | ~$900-1,200    |

## Georeferencing and Accuracy

The onboard GPS geotags every image with a position
accurate to roughly 2-6 metres. For building mapping, that
is usually enough: you get a correctly stitched ortho that
may be offset from true position by a few metres, but
buildings are the right shape and size relative to each
other.

If the ortho needs to line up precisely with existing map
data, you can shift it to match known features (roads,
intersections, existing building outlines). Vertical
accuracy can be corrected in post-processing using
reference surfaces.

**Ground Control Points (GCPs)** - surveyed markers placed
on the ground before flying - will improve absolute
positioning to tens of centimetres. They are useful but
not essential for building mapping. If you have access to
a GPS and the time to set up markers, use them. If not,
the ortho is still usable - you may just need to offset
it.

## Hardware

A custom quadcopter requires the following categories of
hardware. See the [Component List](#may-2026-component-list)
below for specific parts and prices.

**Airframe + propulsion**: a 450-500 mm quadcopter frame
with 4 brushless motors, 4 ESCs (electronic speed
controllers), propellers, and a power distribution board
(often integrated into the frame).

**Power**: a 4S LiPo battery and a balance charger. Buy at
least two batteries for field use.

**Flight control**: a Pixhawk-class autopilot running PX4
or ArduPilot firmware, a GPS + compass module, and a
telemetry radio (433 or 915 MHz depending on region) for
the MAVLink link between the drone and your ground station
laptop.

!!! important "Avoid unbranded Pixhawk 2.4.8 clones"

    The cheapest Pixhawk boards (~$25 on AliExpress) are
    unbranded clones with well-known reliability problems:
    sensor failures, compass errors, and firmware issues.
    **Spend the extra $10-20 on a branded board.** For
    budget builds, use a Radiolink Pixhawk (~$35-50). For
    high-end, use a Holybro Pixhawk 6C Mini (~$131) or
    6C (~$166).

**Imagery capture**: a camera module connected to a
companion computer (Raspberry Pi) which captures, geotags,
and stores images. A single camera pointed straight down
(nadir) is the minimum. Adding a second camera at 45°
captures building facades and features hidden from above.

**Storage**: a MicroSD card for the Pixhawk (flight logs)
and one for the companion computer (captured imagery).

**Optional**: an RC transmitter + receiver for manual
override. Recommended as a safety measure.

!!! important

    Be sure you are taking any restrictions from your
    aviation authority into account when planning the build.

    The drone must be registered to be flown.
    If in doubt, clarify with them first.

### Assembly

1. Mount motors to frame
2. Wire ESCs to flight controller
3. Connect GPS + telemetry
4. Install battery system
5. **Balance all propellers** (see below)
6. Mount camera underneath on **vibration-isolated bracket**
   (see below)
7. Connect camera to companion computer
8. Secure all wiring and verify no loose components

### Vibration Management

!!! warning "This is critical for mapping"

    Commercial mapping drones like the DJI Mini 4 Pro have
    a gimbal that absorbs vibration. This build has no
    gimbal. If vibration from the motors reaches the
    camera, you get "jello" distortion - wobbly, warped
    images that are **unusable for mapping**. There is no
    software fix for badly jello-affected images. Getting
    vibration right is not optional.

There are two things to get right: **reduce vibration at
source** and **isolate the camera from what remains**.

**1. Balance every propeller before flight.**

Unbalanced propellers are the single biggest source of
vibration on a quadcopter. Cheap nylon props (1045s) are
often significantly out of balance from the factory.

Use a magnetic propeller balancer (~$5-15). Place the prop
on the balancer, see which side dips, and add small pieces
of tape to the light blade (or carefully sand the heavy
blade) until it sits level. This takes 2-3 minutes per
prop. Do it for every prop, every time you fit new ones.

**2. Isolate the camera from the frame.**

The camera mount must be mechanically decoupled from the
frame using soft rubber. Two proven approaches:

- **Rubber ball dampers** (also called "gimbal dampers") -
  small rubber balls with screw studs at each end. Mount
  4 of these between the frame and a camera plate. These
  are widely available (~$3-5 for a set of 4, search
  "anti-vibration rubber ball damper drone" on AliExpress).
  This is the recommended approach.

- **Silicone grommets or O-rings** - thread bolts through
  silicone grommets to mount the camera plate. Cheaper but
  harder to tune.

The goal is that if you tap the frame, the camera plate
should wobble gently on its mounts rather than transmitting
a sharp vibration. If it feels rigid, the isolation is not
working.

**3. Also soft-mount the flight controller.**

The Pixhawk has its own IMU sensors that are affected by
vibration. Use the foam pads included with the Pixhawk
(or a dedicated anti-vibration mounting plate, ~$3) to
isolate the flight controller from the frame. High
vibration readings in the Pixhawk logs (visible in
QGroundControl) indicate a problem.

**4. Check for jello on a test flight.**

Before flying a mapping mission, do a short test hover
and capture a few images. Look at them on a screen. If
straight lines (rooftops, roads) appear wavy or wobbly,
you have a jello problem. Fix it before flying a real
mission - the images will be unusable.

Common fixes if jello persists:

- Re-balance propellers (they may have been damaged)
- Check for loose motor screws or bent motor shafts
- Try softer damper balls on the camera mount
- Replace cheap propellers with better quality ones
  (still 1045 size, but from a reputable brand)

## Software

### Install Firmware (MAVLink Enabled)

Flash PX4 onto the Pixhawk and configure: frame type
(quadcopter), GPS, failsafes, telemetry link, and radio
control (if using).

> **PX4 or ArduPilot?** Both are open-source, both use
> MAVLink, and both work with QGroundControl. For
> autonomous waypoint missions they are functionally
> interchangeable. This guide references PX4 as the
> default since it is the native firmware for Pixhawk
> hardware, but ArduPilot is a drop-in replacement if
> preferred.

### Connect Controller

Connect the Pixhawk to a device running QGroundControl
(your laptop / device 'base station'). QGroundControl
sends MAVLink instructions to the PX4 flight controller.

### Generate Flightplans In DroneTM

DroneTM generates QGroundControl-compatible flightplans.
These are imported into QGroundControl and sent as MAVLink
instructions to the onboard controller.

## May 2026 Component List

Both tiers share the same airframe. The difference is the
flight controller and camera setup.

### Airframe (common to both tiers)

| #   | Component                                       | Recommended                                                                | Backup                                   | Est. USD      |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------- | ------------- |
| 1   | Frame                                           | S500 500 mm PCB + landing gear                                             | F450 450 mm (less payload room)          | $15-30        |
| 2   | Motors ×4                                       | A2212 920KV brushless                                                      | Any 2212/2216 800-1000KV                 | $12-25        |
| 3   | ESCs ×4                                         | 30A SimonK or BLHeli                                                       | Any 30A brushless ESC w/ 5V BEC          | $10-22        |
| 4   | Propellers                                      | 1045 nylon CW+CCW (buy 3+ spare sets)                                      | 9450 props                               | $3-6          |
| 5   | GPS                                             | u-blox NEO-M8N + compass on mast                                           | BN-880 or M10 GPS/compass                | $10-22        |
| 6   | Telemetry radio                                 | SiK V3 - 433 MHz (EU/Africa) or 915 MHz (Americas)                         | Any 3DR-compatible telemetry pair        | $15-35        |
| 7   | Battery ×2                                      | 4S 14.8V 5200 mAh 35C+ LiPo (XT60)                                         | Any 4S 3300-5200 mAh LiPo                | $50-90        |
| 8   | Charger                                         | IMAX B6 balance charger (or clone)                                         | Any LiPo balance charger supporting 4S   | $12-25        |
| 9   | Storage                                         | 2× MicroSD (8 GB for Pixhawk, 32-64 GB for SBC)                            | Any Class 10 MicroSD                     | $8-15         |
| 10  | Camera mount                                    | 3D-printed fixed bracket on **rubber ball dampers** (nadir + optional 45°) | Aluminium L-bracket on silicone grommets | $5-15         |
| 11  | Prop balancer                                   | Magnetic propeller balancer                                                | Any prop balancer                        | $5-15         |
| 12  | Wiring & sundries                               | XT60 connectors, zip ties, foam tape, heat shrink, battery strap           | -                                        | $10-20        |
|     | **Airframe subtotal (excl. flight controller)** |                                                                            |                                          | **~$155-310** |

### Budget Build

| Component                           | Recommended                                                   | Est. USD      |
| ----------------------------------- | ------------------------------------------------------------- | ------------- |
| Flight controller                   | Radiolink Pixhawk 2.4.8 (branded)                             | $35-50        |
| Companion computer                  | Raspberry Pi Zero 2 W                                         | $15           |
| Camera                              | Raspberry Pi HQ Camera (IMX477) + 6 mm low-distortion CS lens | $60-80        |
| **Budget camera + FC subtotal**     |                                                               | **~$110-145** |
| **Budget total (airframe + above)** |                                                               | **~$400-500** |

**Why the Pi HQ Camera and not the cheaper Pi Camera
Module 3?** The Pi Camera Module 3 (~$30) uses autofocus
and a fixed lens with significant barrel distortion. Both
hurt stitching accuracy. The Pi HQ Camera uses
interchangeable lenses and manual focus - you fit a
low-distortion 6 mm CS lens (~$10-20 on AliExpress,
search "6 mm CS lens 5 MP low distortion"), lock focus to
infinity, and get significantly better orthomosaic
geometry. The lens is the most important part of the
camera for mapping.

**Budget tier: what to expect and how to get the best
results**

The Pi HQ Camera produces a usable 12 MP ortho at
~2.5 cm/px GSD (at 80 m altitude). Buildings are clearly
identifiable and traceable. The main limitations vs. the
high-end tier are:

- **Smaller sensor** (1/2.3") means worse low-light
  performance. Fly in good daylight only.
- **Rolling shutter** on a small sensor means you need to
  fly slowly (≤6 m/s) and keep shutter speed fast
  (≥1/1000s). Set exposure manually before each flight -
  do not use auto exposure.
- **No gimbal** - the camera is fixed to the frame via
  vibration dampers. This is the biggest risk on the
  budget tier. Follow the
  [Vibration Management](#vibration-management) steps
  carefully. If your propellers are unbalanced or your
  camera mount is too rigid, you will get jello distortion
  and the images will be unusable.
- **The flight controller** (Radiolink Pixhawk) is
  adequate for autonomous waypoint missions but has less
  sensor redundancy than the Holybro boards. Test
  thoroughly before field deployment.

To mitigate these limitations:

- **Balance your propellers** before every new set.
- **Test for jello** on a short hover before each mapping
  mission.
- Fly with **≥80% frontlap and ≥70% sidelap**. More
  overlap compensates for any individual soft images.
- Fly at **≤6 m/s**. Slower is better.
- **Set exposure manually**: shutter ≥1/1000s, ISO as
  low as lighting allows.
- Process with **OpenDroneMap** and enable
  rolling shutter correction if available.
- If the resulting ortho is offset from your base map,
  shift it to align with known features.

### High-End Build

| Component                             | Recommended                                                  | Est. USD        |
| ------------------------------------- | ------------------------------------------------------------ | --------------- |
| Flight controller                     | Holybro Pixhawk 6C Mini (or 6C)                              | $131-166        |
| Companion computer                    | Raspberry Pi 5 1 GB (or Pi 4 2 GB)                           | $45             |
| Camera                                | Arducam IMX586 48 MP USB3 + 6 mm low-distortion C-mount lens | $130-150        |
| **High-end camera + FC subtotal**     |                                                              | **~$310-360**   |
| **High-end total (airframe + above)** |                                                              | **~$900-1,200** |

The Arducam IMX586 uses the same 1/2.0" 48 MP quad-Bayer
sensor technology found in consumer drones. In 12 MP
binned mode it produces ~1.6 cm/px GSD at 80 m with good
light gathering and fast readout.

!!! important "Replace the stock lens"

    The Arducam ships with a motorised autofocus lens.
    **Replace it with a fixed 6 mm low-distortion C-mount
    lens** (~$20) and lock focus to infinity. Autofocus
    can shift during flight and the stock lens is not
    optimised for low distortion.

The Holybro Pixhawk 6C Mini has redundant IMUs, vibration
isolation, temperature-controlled sensors, and active
firmware support. It is a significant reliability upgrade
over the budget Pixhawk.

The Pi 5 (1 GB, ~$45) provides USB 3.0 needed for
full-speed 48 MP capture. The 1 GB model is sufficient -
the SBC only needs to capture images and write them to SD.

**High-end tier: what to expect**

With the right lens and good daylight, this build produces
orthomosaics comparable to a DJI Mini 4 Pro in resolution
and stitching quality. The DJI has a slightly larger
sensor (1/1.3" vs 1/2.0") and a factory-calibrated gimbal,
so it has an edge in low light and consistency. In
practice, for daytime building mapping the difference is
small.

The one area where this build requires more care than a
DJI is vibration management. The DJI's gimbal handles
vibration automatically. On this build, you need balanced
propellers and a properly isolated camera mount (see
[Vibration Management](#vibration-management)). Once
that's done, follow the same flight practices as any
consumer mapping drone: fly at ≤8 m/s, ≥80% frontlap,
≥70% sidelap, set exposure manually, and process with
OpenDroneMap or similar.

### Thermal Cameras

Thermal cameras connect via SPI to the companion computer
and are the same for both tiers.

| Option                           | Spec                                                    | Est. USD |
| -------------------------------- | ------------------------------------------------------- | -------- |
| FLIR Lepton 3.5 + breakout board | 160×120, radiometric (calibrated temperature per pixel) | $200-320 |
| FLIR Lepton FS + breakout board  | 160×120, non-radiometric (thermal image only)           | $99-160  |

The 160×120 resolution is useful for spotting heat
anomalies (roof insulation gaps, water leaks, solar panel
defects) but is not high enough for detailed thermal
orthomosaics. It is a scouting tool, not a mapping
sensor. For mapping-grade thermal you need a 640×512
sensor (e.g. FLIR Boson, ~$2,000+) which is outside the
scope of this build.

The Lepton 3.5 gives calibrated temperature data per
pixel. The Lepton FS is cheaper but only produces a
thermal image without temperature values.

### Dual Camera Setup

For 3D reconstruction, mount two cameras - one nadir, one
at 45°. Oblique shots capture building facades, roof
overhangs, and features hidden from directly above.

On the budget tier (Pi Zero 2 W), use an Arducam
multi-camera HAT (~$10) to switch between two CSI cameras.
On the high-end tier (Pi 5), use one USB camera for nadir
and one CSI camera at 45°.

### Build Weight

| Tier     | Dry (no battery) | All-up   |
| -------- | ---------------- | -------- |
| Budget   | ~1,000 g         | ~1,500 g |
| High-end | ~1,100 g         | ~1,600 g |

Both within the S500's max takeoff capacity (~2 kg+).

### Telemetry Frequency by Region

| Region                        | Frequency |
| ----------------------------- | --------- |
| Europe, UK, most of Africa    | 433 MHz   |
| Americas (US, Colombia, etc.) | 915 MHz   |
| Australia, New Zealand        | 915 MHz   |

### Sourcing

All airframe components are intentionally generic - the
A2212 motor, 30A ESC, and S500/F450 frames are among the
most widely cloned drone parts in the world.

For the flight controller, **buy from the manufacturer or
an authorised reseller** (Holybro store, Radiolink store).
Generic "Pixhawk" boards from random AliExpress sellers
are often unreliable clones.

For countries with good e-commerce (Colombia, etc.),
AliExpress ships to most of Latin America (2-6 weeks).
MercadoLibre often stocks generic drone parts locally.

For countries with limited e-commerce (Sierra Leone, etc.):

1. **Local RC / electronics importers** in the capital -
   most stock generic drone parts. Ask for "F450 drone
   kit" or "Pixhawk".
2. **Alibaba** (wholesale, min 5-10 units) - ships
   worldwide via DHL/FedEx.
3. **Pre-purchase and carry with staff** - buy in the
   US/UK/EU and bring in luggage. Most practical for
   specialist parts (flight controller, cameras).
4. **Freight forwarder** (ColisExpat, MyUS) - provides a
   US/UK address and forwards packages internationally.

| Retailer              | Best for                                   | Ships globally?                     |
| --------------------- | ------------------------------------------ | ----------------------------------- |
| AliExpress            | Frame, motors, ESCs, props, GPS, telemetry | Most countries (2-6 wks)            |
| Alibaba               | Bulk orders (5+ kits)                      | Worldwide via DHL/FedEx             |
| Holybro Store         | Pixhawk 6C / 6C Mini, power modules        | Worldwide                           |
| Amazon US/UK          | Batteries, chargers, Arducam cameras       | Many countries; forwarder if needed |
| GroupGets             | FLIR Lepton modules                        | US, UK, EU, AU, CH only             |
| The Pi Hut / Pimoroni | Raspberry Pi boards, Pi Camera modules     | UK/EU; intl. via forwarder          |
| Arducam store         | IMX586 USB3 camera, IMX477 boards          | Worldwide                           |

!!! warning

    **LiPo batteries** cannot go in checked airline luggage.
    Carry-on rules vary by airline. Often easier to source
    batteries locally than to import them.

    **Thermal camera** modules require an End Use Statement
    for international orders. GroupGets ships to
    US/UK/EU/AU/CH only. For other countries, buy in those
    regions and carry to the destination yourself.

## Pre-Flight Checklist

- [ ] All propellers balanced (every new set)
- [ ] Camera mount vibration-isolated (rubber ball dampers
      secure and not hardened/cracked)
- [ ] **Test hover done** - check images for jello before
      flying a mapping mission
- [ ] Camera focus locked to infinity (tape or thread-lock)
- [ ] Exposure set manually (shutter ≥1/1000s, low ISO)
- [ ] Flight plan: ≥80% frontlap, ≥70% sidelap
- [ ] Flight speed set (budget ≤6 m/s, high-end ≤8 m/s)
- [ ] MicroSD cards inserted and formatted
- [ ] Batteries fully charged (flight + SBC)
- [ ] Telemetry link confirmed in QGroundControl
- [ ] Weather: low wind, good daylight, no rain
- [ ] GCPs placed and surveyed (if using)
