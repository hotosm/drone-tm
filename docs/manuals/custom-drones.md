# Building Custom Drones (For DroneTM)

Sometimes it may not be possible to buy a drone off the shelf
that is easily compatible with DroneTM.

A good example of this would be for thermal imagery projects.

In these cases, it may be preferable to assemble a custom
drone using standard quadcopter components.

## Summary

| Component                             | Role                                               |
| ------------------------------------- | -------------------------------------------------- |
| **Pixhawk**                           | Flight controller (autopilot)                      |
| **QGroundControl**                    | Ground control software used to plan/send missions |
| **DroneTM**                           | Generates the mission plan                         |
| **Companion Computer** (Raspberry Pi) | Captures + geotags thermal images                  |

## Hardware

### Parts Required (Quadcopter)

Airframe + Power:

- Frame (450–500mm quadcopter frame)
- 4 motors + propellers
- 4 ESCs
- Power distribution board
- Battery (likely 4S–6S LiPo)
- GPS + compass module
- Telemetry radio (915/433 MHz depending on region),
  for sending instructions from ground station.

Flight Control:

- Autopilot flight controller (e.g. Pixhawk running ArduPilot or PX4)

Imagery Capture:

- Thermal camera module (e.g. FLIR Boson / similar
  lightweight thermal core). This could be any other type
  of remote sensor you may need (e.g. infrared).
- Companion computer (e.g. Raspberry Pi / Jetson Nano) to
  (1) Process images (2) Geotag them (3) Store them

Storage:

- MicroSD card for the Pixhawk (used for flight logs)
- MicroSD card for the companion computer (used for storing captured imagery)

Optional Control:

- RC transmitter + receiver (i.e. for flying manually, in case autopilot fails).
- Necessary as a safety measure ideally.

Total build weight: likely 1.5-2kg

!!! important

    Be sure you are taking any restrictions from your aviation
    authority into account when planning the build.

    The drone must be registered to be flown.
    If in doubt, clarify with them first.

### Assembly

1. Mount motors to frame
2. Wire ESCs to flight controller
3. Connect GPS + telemetry
4. Install battery system
5. Mount thermal camera underneath
6. Connect thermal camera to companion computer
7. Secure everything properly (vibration dampening for camera)

## Software

### Install Firmware (MAVLink Enabled)

1. Flash ArduPilot or PX4 onto the flight controller
   (Pixhawk).
2. Configure params:

- Frame type (quadcopter)
- GPS
- Failsafes
- Radio control (optional)
- Telemetry link

### Connect Controller

- Connect your flight controller to a device running
  QGroundControl (your laptop / device 'base station').
- QGroundControl can send MAVLink instructions to
  your PX4 or Ardupilot enabled flight controller.

### Generate Flightplans In DroneTM

- DroneTM can generate QGroundControl flightplans.
- These can be imported into the app, then send as MAVLink
  instructions to the onboard controller.
