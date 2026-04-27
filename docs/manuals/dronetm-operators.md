# Drone Operator Manual

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
