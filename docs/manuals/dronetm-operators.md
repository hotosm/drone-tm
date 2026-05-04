# Drone Operator Manual

## Getting started

1. **Register and set your role** - sign up at <https://drone.hotosm.org/> and
   select "I am a drone operator" on your profile.
2. **Browse available projects** - open the Projects list to find mapping
   projects near you or that match your equipment.
3. **Claim a task** - select an individual task area within a project that you
   are available and equipped to fly. Tasks are sized to be flyable on a single
   battery charge.
4. **Download the flight plan** - once a task is locked to you, download the
   flight plan file appropriate for your drone model and controller.
5. **Fly the mission** - transfer the plan to your drone and execute it in
   autonomous mode (see [Always Fly Autonomous Missions](#always-fly-autonomous-missions)).
6. **Upload your images** - after landing, upload the raw images from your SD
   card via the task upload dialog. The platform will handle pre-processing and
   final orthomosaic generation automatically.

See drone specific advice under:

- [DJI](./dji.md)
- [Potensic](./potensic.md)

## Setup

### a. Drone Model

See the table of [supported drones](https://github.com/hotosm/Drone-TM/#roadmap).

### b. Controller

<!-- prettier-ignore-start -->
| Controller | App file copy | Web file copy | Manual file copy |
|:------:|:-------:|:-------:|:--------|
| RC-2* | ✅ | ❌ | ✅ |
| RC-N2 | ✅ | ✅ | ✅ |
| RC-N3 | ✅ | ✅ | ✅ |
<!-- prettier-ignore-end -->

If using a controller **without** an in-built screen, then your mobile
device will be used as the screen / controller. For best user experience
(web file copy), ensure your device has **ADB** enabled (search how to do
this for your model).

!!! note

      *recommended controllers

      Starred controllers have an integrated screen.
      We recommend them because they are guaranteed to work with our
      workflows.

      Other models that require you to use your own phone as a screen
      will also work (e.g. RC-N2), but we have less control over the process
      and cannot guarantee every phone will work well (high-spec devices
      will perform better).

### c. SD Card

#### Selecting a card

- We need a micro SD card to capture the imagery in the drone.
- You should look for models with a U3 rating or above, indicating
  a sustained write speed of 30 MB/s.
- Models with less than this, e.g. a (10) rating meaning 10 MB/s,
  will not be fast enough to write multiple images in a row.

#### Connecting the card

- Be sure to plug into the **drone** and not the controller.
- When plugging in the SD Card, you may be prompted to format.
  Accept this prompt.
- Otherwise, you must select and format the card via the controller
  settings menu, under the 'Image' section.
- In the worst case scenario, when the SD Card is not recognized,
  first put the card into a computed, format to **exFAT**, then place
  back into the controller.

## Field Team Roles

Teams in the field should include at least two people: a pilot who monitors
the drone's flight on the computer screen, and an observer who maintains sight
of the drone and surrounding airspace at all times while flying within visual
line of sight.

At the takeoff location, the team's designated safety officer ensures that all
precautions are taken before, during, and after flights. At every step from
launch to landing, the designated safety officer should coordinate actions and
communications (with loud voice signals).

For sustained multi-day operations (such as post-disaster response), a
minimum **three-person crew** is recommended: two in the field collecting data and
operating the aircraft, and the third processing data from the day before.
Rotating the third person through the data collection and flight crew provides
crew members with rest, while also ensuring progress on data
collection/processing. The full day of flying means that hours are spent at
night ensuring batteries are charged, data backed up, missions planned, and
equipment ready for the next day.

## Battery and Power Management

Lithium polymer (LiPo) batteries used in drones are highly flammable and must
be transported in LiPo safety bags when travelling. On commercial flights,
passengers are allowed a maximum of two 100-160 Wh batteries, which must be
kept in carry-on luggage. Quantities of smaller batteries are not usually
limited, but some airlines or airport security staff may take away what they
perceive as excessive quantities of batteries. Before travelling with batteries
related to a drone mission, it is advisable to obtain the airline's transport
policy in writing so there will be no question of permissibility.

When working in the field, power can be limited. A good power supply should be
ensured both on site and at the facility where processing of the data will take
place. Options include:

- Solar charger or car inverter for field charging
- Reliable electricity or on-site generator at the hotel or office
- Multiple fully charged battery packs as backup

Plan power for both drone batteries and processing devices (laptops, tablets,
controllers).

> _Adapted from: World Bank and Humanitarian OpenStreetMap Team (2019).
> Technical Guidelines for Small Island Mapping with UAVs.
> CC BY 4.0._

## Always Fly Autonomous Missions

All mapping flights must be flown in autonomous mode following a pre-planned
flight plan in order to obtain images suitable for creating a mosaic. Pilots
manoeuvring the aircraft manually cannot ensure that the correct pattern is
being followed and enough overlap is maintained between frames and flight lines.

- Use a mission planner (DroneTM, or any tool that produces a structured grid
  the drone executes autonomously).
- Set overlaps explicitly: 75-80% front, 70% side for good 3D products.
- Preview the generated grid in the planner before flight to confirm full
  coverage of the area of interest.
- If a mission needs more coverage than originally planned, extend the planned
  grid and re-fly - don't improvise extra coverage with manual flying.

## Consistent Altitude Across Tasks

This is the single biggest factor affecting DSM/elevation quality without RTK
or GCPs. If per-task flight altitudes vary significantly across a project, the
photogrammetric bundle adjustment produces a DSM that mirrors flight-altitude
differences instead of real ground elevation.

- Set altitude as AGL (above ground level) relative to the area of interest's
  mean ground elevation, not "above home point". 100-120 m AGL is standard.
- For variable-terrain areas of interest, use terrain-following mode with a
  DEM-aware mission planner.
- Across all tasks of one project, target altitudes should agree to within
  +/- 5 m.
- If the planner only supports "above home point", take off from the same
  launch location for every task in the project.

## Camera Settings

Camera settings are a judgement call based on conditions, not a fixed default.
Full auto (per-frame auto-exposure + auto white balance) is the one mode to
avoid - it creates tonal inconsistency that fights ODM / DroneDeploy mosaic
blending.

- **Stable light:** full manual (fixed ISO / shutter / aperture / white balance)
  gives the most consistent mosaic.
- **Moderately variable light:** AE-lock (meter once, lock for the mission,
  re-meter if conditions shift noticeably) adapts better than pure manual
  without per-frame hunting.
- Keep shutter speed at 1/2000 s or faster on a moving drone to limit motion
  blur.

## Image Format and Resolution

For mapping work, there is no need to capture at the sensor's maximum
resolution. Processing software resizes images during feature matching (ODM
defaults to 2048 px wide), and final orthos are produced at the target GSD you
pick (usually 2-5 cm/pixel), not the sensor maximum.

- **Resolution:** 4096 px wide (~3 cm GSD) is a safe ceiling for
  settlement/urban mapping and is visually indistinguishable from native
  resolution. 2048 px wide (~6 cm GSD) still cleanly resolves buildings, roofs,
  and vehicles.
- **JPEG vs DNG/RAW:** Capture in JPEG under stable conditions - it saves 3-4x
  storage and upload time, and avoids compatibility issues with some processors
  (see [#777](https://github.com/hotosm/drone-tm/issues/777)). Use DNG+JPEG as
  insurance only when conditions are variable or for high-stakes captures. DNG
  enables roughly a 2-stop shadow recovery for uniformly dark frames, but is
  less helpful for mixed-light gradient frames (e.g. a cloud edge crossing
  mid-shot).

## Flight Checklist

Be sure to review the [Flight Checklists](./flight-checklists.md)
before you plan to fly.

## Field Workarounds

This section covers some workarounds discovered by drone operators,
to get around the limitations of the platform (until it's improved).

### The drone returned while the flight was part way through

- Ideally the task areas should be optimised to fly for ~70%
  of the battery capacity, but sometimes this doesn't happen.
- There is a 'field hack' workaround for now to continue from
  where the flightplan cut out part way.
- In the DJI controller, go to waypoint mode and delete waypoints
  (manually scroll to the beginning, delete one, scroll again to
  beginning, delete again, etc).
- Save the waypoint flight and fly it again with only the required
  points.

## End-of-Day Debrief

Especially during the first days of a project, the team should hold a short
debrief at the end of each mapping day.

Use this time to share any issues or lessons from the field, such as:

- flightplan transfer problems
- battery performance and charging constraints
- takeoff / landing considerations
- weather, signal, or access issues
- changes to methods that made flying safer or more efficient

A short daily discussion helps the team identify repeated problems early and
adapt the workflow before they affect more flights.
