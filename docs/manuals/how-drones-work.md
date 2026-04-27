# How Drones Work

## General Unmanned Aircraft Knowledge

### Unmanned Aircraft (UA)

Unmanned Aircraft (UA), commonly known as drones, may be flown or used
without any individual onboard to operate the aircraft. UA can include:
airships; aeroplanes; rotorcrafts; and powered-lift. DJI Mini 5 Pro, and
similar drones, used by HOT are multirotor rotorcrafts.

UAs have many applications, including precision agriculture, search and
rescue, and monitoring of ecosystems like forests.

### Unmanned Aircraft System (UAS)

Unmanned Aircraft System (UAS) refers to the UA and its components. It
largely consists of its: airframe; landing gears; electrical system; power
distribution board; power management unit; battery; the propulsion system:
propellers; motor; and electronic speed controller; flight controller;
Inertial Measurement Unit (IMU); barometer; Global Positioning System (GPS);
and magnetometer.

Of special note, the GPS supports localisation of the UA in outdoor
environments and is used to stabilise its position, record home point for
Return-to-Home, and autonomous flight modes.

The UA can also come with a payload, which typically are cameras for HOT's UA
use cases. There are several types of cameras, including traditional optical
cameras, multispectral cameras, LiDAR, and thermal cameras.

### Ground Control System (GCS)

To operate properly, a UA requires several ground-based components to receive
telemetry information, and video feed, if any, from the UA. This includes:
the interface device, such as mobile phones, tablets, or integrated monitors;
telemetry transceiver (transmitter and receiver); video receiver, if any; and
the Command & Control (C2) System, usually the remote controller.

## When to Use a Drone vs. Other Methods

Drones are not always the best mapping tool for a project. Before deciding
whether to use a drone, a satellite, or other tool, the project's data needs,
budget, and time frame must be understood.

|                        | Satellite            | Airplane            | Drone                                |
| :--------------------- | :------------------- | :------------------ | :----------------------------------- |
| **Area per day**       | ~10,000 km²          | ~750 km²            | 1-25 km²                             |
| **Detail level**       | 30-50 cm/pixel       | > 6 cm/pixel        | 3-10 cm/pixel                        |
| **Time to deploy**     | 24 hours - 1 week    | 3 days              | 24 hours (with permits)              |
| **Ease of deployment** | Easy (once in orbit) | Medium              | Easy                                 |
| **Blocked by clouds**  | Yes                  | Depends on altitude | No (but fog and rain affect results) |
| **Blocked by wind**    | No                   | No                  | Yes                                  |
| **Regulatory burden**  | Low                  | Medium-high         | Medium-high                          |

A drone is preferable for mapping a small footprint (e.g. small pockets of
high-risk areas, a small and remote community). Satellites are most practical
for acquiring baseline imagery of large areas at a resolution of 50 cm/pixel
with a capture window of one year. More often than not, a single method is not
used exclusively; rather, the various survey methods are used to complement one
another.

> _Adapted from: World Bank and Humanitarian OpenStreetMap Team (2019).
> Technical Guidelines for Small Island Mapping with UAVs.
> CC BY 4.0._

## How Drones Fly

There are different forces acting on a UA. Lift is the force created by the
wings or propellers that pushes the UA upwards. Weight is the opposite force
to lift, and pulls the UA downwards due to gravity. Thrust is the force
created by the propeller or engine that pulls the UA forward. Drag is the
opposite force to thrust, and is created by air resistance.

By adjusting these different forces, the pilot can maneuver the UA. For
example, if lift is greater than the weight, the UA will ascend; and if thrust
is greater than the drag, the UA will move forward or backward.

In addition, pilots need to be aware of the UA's different maneuver options
available:

### Elevation

An elevation is the vertical movement, upwards or downwards, of the UA. This
allows the UA to go higher or lower.

### Yaw

A yaw is the horizontal, clockwise or counterclockwise rotation of the UA.
This allows the UA to change its heading.

### Pitch

A pitch is the tilting forward or backward of the UA. This allows the UA to
move forward or backward.

### Roll

A roll is the tilting left or right of a UA, along its central axis. This
allows the UA to slide sideways while maintaining its heading.

### Stick Modes

Pilots can work with 4 different types of stick modes on their controller to
operate the elevation, yaw, pitch, and roll. Mode 2 is the global standard.

## UA Flight Modes

There are different flight modes that pilots should be aware of.

### Altitude Hold

The flight controller will maintain the UA's altitude, or height, when the
control sticks are centered.

### GPS Mode

GPS is utilised to assist the UA in holding precise positions, ensuring
stability against winds. This automated mode helps pilots to easily operate
the UA without needing to compensate for winds.

### Attitude Hold (ATTI)

The flight controller will stabilise the UA's orientation, i.e. no roll or
pitch, but does not maintain altitude or position and can be easily adjusted
by the wind. This is considered a manual mode as pilots will need to operate
the UA properly against shifting winds.

Attitude hold will be necessary when GPS signals are poor or unavailable. In
the case of DJI Mini 5 Pro, the UA switches to ATTI mode when GPS is weak or
downward sensors fail.

### Automated Flight Path

Automated flight paths can be pre-programmed for UAs using GPS waypoints,
enabling them to fly without a pilot.

## UA Automated Safety Features

Today, UAs come with advanced technologies that help the pilot to operate
safely.

### Avoidance Collision

The UA employs its sensors to automatically avoid obstacles.

### Return-to-Home (RTH)

Return-to-Home (RTH) is a safety feature that automatically flies a UA back to
its original takeoff location (home point) using GPS.

## Image Overlap: Why It Matters

When flying, drone sensors collect images frame by frame. After the flight,
these frames need to be stitched together to create a mosaic image that shows
the entire area seamlessly. The processing software (Structure from Motion)
works by finding matching features between overlapping photos, so sufficient
overlap between frames is essential.

Forward and side overlap - the amount of overlap between frames in the forward
and lateral direction from the platform's direction of movement - must be
properly handled to create seamless mosaics that represent the location of
features in the image.

**Recommended minimums:**

- **Basic 2D orthomosaic:** minimum 60% forward overlap and 30% side overlap
- **Accurate terrain models (3D):** minimum 80% forward overlap and 75% side
  overlap, to maximise the number of observations of landscape features

There is a tradeoff between the time available for the survey and the overlap.
The more overlap, the more time is required to complete the flying, and the more
storage is needed for the images. However, more overlap produces better results.

When creating a flight plan, it is important to include extra flight lines and
frames outside of the area of interest to cover all perimeter zones with enough
frames. As a rule of thumb, two extra frames at the end of each flight line and
one extra flight line on each side of the area of interest are normally enough
to ensure proper coverage. Most flight-planning software will already account
for the need for additional overlap.

Flight altitude should be set at a fixed value above mean sea level for areas
with homogeneous ground elevation and should be adjusted above ground level when
elevation changes significantly (e.g. mountainous areas). This ensures a
consistent overlap ratio between frames even when the distance between platform
and target ground changes.

## Landscape Limitations for Mapping

Processing software relies on automatic extraction of point features from
input images. In the case of imagery collected over visually homogeneous pattern
areas such as water, bare desert, or snow and ice, it is almost impossible for
the software to discriminate unique points and match frames correctly. Accurate
IMU (inertial measurement unit) information may sometimes compensate for the
lack of feature points in these areas and provide enough positional information
for correct orthomosaicking.

If your area of interest includes large stretches of water or other uniform
surfaces, expect reduced quality in those zones of the final mosaic.

## GPS Geotagging

For post-processing, each frame taken by the camera needs to be tagged with its
GPS location. This is an important process to ensure positional accuracy of the
output. Most consumer mapping drones (such as the DJI Mini series) handle this
automatically - the camera is linked to the onboard GPS, and each image is
tagged with location information via EXIF metadata.

Before flying, always ensure you have a strong GPS lock (the flight controller
will typically indicate this). Without accurate GPS tags on images, the
processing software cannot position images correctly and the final mosaic will
have poor georeferencing.

> _Adapted from: World Bank and Humanitarian OpenStreetMap Team (2019).
> Technical Guidelines for Small Island Mapping with UAVs.
> CC BY 4.0._

## Reasons Why UA Fail

As the pilot relies on a signal connection to operate the UA, there are
several ways that UA can fail, creating safety risk to the pilot and people
nearby. It is important that pilots fly the UAs within their visual line of
sight and avoid "flying blind".

### Radio Interference

Many UAS operate on radio frequencies like 2.4 GHz and 5.8 GHz, and other
sources of radio transmission in the flight environment can interfere with the
UA signal. Some sources of interference can include:

- radio frequencies from another nearby UA in operation
- WiFi
- mobile phone
- cellular network towers
- microwave antennas
- high voltage lines
- power stations
- broadcasting towers

### Signal Degradation

The signal to-and-from the UA can degrade, making it difficult to control your
UA. Some reasons for signal degradation can include:

- Free-space path loss: signals degrade over distance, and the farther they
  have to travel, the weaker they become.
- Absorption loss: signals that pass through objects between the UA and the
  remote controller may be partly absorbed and become weaker.
- Diffraction loss: signals that diffract around objects between the UA and
  the remote controller may become weaker.
- Multi-path interference: signals may be reflected and split, reaching the
  receiver from different paths and interfering with each other.

The terrain, such as hills, buildings, and even vegetation, such as trees, may
weaken or obstruct the signals.

### Link Loss

The signal interference can result in a loss of link between the UA and the
remote controller. In most cases, a link loss will trigger the RTH failsafe
which automatically pilots the UA back to its original landing point or to the
pilot, depending on the settings. However, this failsafe might not function
correctly, resulting in a "flyaway" UA where the UA will continue to operate
based on the last command and continue to fly off.

### Preventing Interference and Link Loss

Pilots should be aware of the environment they intend to fly in and should try
to fly in open areas. To improve signal connections, reduce objects between
them and the UA, and avoid areas with strong electromagnetic or radio sources.

In the event of possible link loss, pilots should also ensure that a home
point has been set for RTH to work properly. This includes adjusting the home
point if the pilot has moved. Pilots should also maintain their UAs within
visual line of sight to ensure that they are able to respond rapidly in case
of any emergencies. Pilots should also set an appropriate RTH altitude to
avoid any collision during RTH. Lastly, always ensure that the remote
controller is switched on first before the UA is switched on, and switched off
last after the UA is switched off, to ensure that the pilot can operate the UA
in case of any issues.
