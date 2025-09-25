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

- Ensure you have assessed the surrounding before takeoff. Is there
  anything overhead? Might the conditions here change over time
  (e.g. a car might be present when the drone returns).
- Check the ground on which you place the drone. Is it level?
  Are there nearby obstacles it could collide with easily?
  It's good to clear away debris and vegetation where possible.
- Is the drone facing away from you before takeoff? The drone
  should be in an orientation that is easily controllable,
  should there be an issue during takeoff and manual control
  is required.
- Have you practiced how to manually control the drone? This is
  essential for if there are issues during the takeoff or landing
  and manual takeover is required.
- **Ensure you keep line-of-sight of the drone at all times**.
  Sometimes various issues can occur mid-flight, such as 'fly-away'
  for misconfigured drones that you may have to catch before they
  get too far, or uncontrollable issues such as being attacked by
  birds.
- Unfold the controller antenae and ensure they point at the drone
  to maintain a good connection. If signal is lost, the drone may
  return early.
- Continually watch the flight and ensure the mission does not
  return early due to an issue.

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
