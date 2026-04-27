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
