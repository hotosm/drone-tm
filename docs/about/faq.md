# ❓ Frequently Asked Questions ❓

## Q. What problem do we solve with DroneTM?

**Enhancing Emergency Response**
We address the need for faster and more precise deployment of drones during
emergencies, enabling improved resource allocation and decision-making
to ensure quicker and more effective crisis management.

**Empowering Local Communities**
We solve the challenge of limited access to real-time aerial data
by equipping local communities with insights that enhance disaster
preparedness, support local initiatives, and enable informed decision-making.

**Optimizing Operational Efficiency**
We tackle inefficiencies in drone operations by streamlining tasking,
reducing manual interventions, and minimizing resource wastage, resulting in cost and time savings.

**Streamlining Access to Drone Data**
We eliminate barriers to accessing drone data by providing a centralized
platform, ensuring critical information is easily available to stakeholders for better decision-making.

---

## Q. How do I get started with DroneTM?

You can contribute to DroneTM in multiple ways:

1. If you have a DJI Mini 4 Pro drone, you can choose nearby projects, capture images, and upload them.
2. If you need drone imagery for your locality, you can create a project with the necessary details.
3. If you're a developer, you can fork the project and contribute
   to its development. We encourage starting with tickets labeled as “good first issue.”

---

## Q. What are the outputs I get from DroneTM? Are they raw drone imagery or the processed data like orthophotos and surface models?

Currently, only processed data is available for download. The final outputs include:

- **2D Orthophoto**: a birdseye view of your area (like a high resolution satellite image).
- **3D Point Cloud**: this can be used to generate Digital Terrain / Surface Models.

---

## Q. Do I need an OSM account or need to create a new account to contribute to DroneTM?

No, you don’t need an OSM account. You can simply sign up using your Google account.

---

## Q. What if the project area of my project is large and needs multiple flight operations?

DroneTM divides large project areas into multiple tasks, allowing you to adjust the area per task.
**Note:** The maximum project area allowed is 100 sq. km.

---

## Q. What if my project creation contains no-fly zones?

During project creation, you can specify that the project area includes
no-fly zones. There is a feature to draw these zones on the project map, and the flight plan will exclude any specified no-fly zones.

---

## Q. What Drones Are Supported?

Currently, DroneTM is tested on **DJI Mini 4 Pro**, and flight plans are optimized for its camera specifications.
However, the system is compatible with any DJI drones that support waypoint features, such as:

- **Mavic 3/3P/3C**
- **Air 3/3S**
- **Mini 4 Pro**

Users can also download the **GeoJSON** of the task area, load it into their
drones, and create custom flight plans as per the specifications provided by the project creator.

!!! note

      We have two angles to increase the number of supported drones:

      1. Support for interfacing with flight plan software such as DroneDeploy
      and Litchi, meaning any drone supported there is supported by
      DroneTM.

      2. Support for Open-Source flight plan software such as ArduPilot and iNAV,
      widening our support signficantly to cheap custom-made drones, and in future
      the HOT mapping drone.

## Q. What Drones Are Not Supported?

We don't have an exhaustive list of all unsupported drones, but in general, if
the drone is not listed as supported, then DroneTM will probably not work with
it.

Our goal is to support affordable community mapping drones that ideally cost
less than 1000 USD, so support for expensive commercial drones will not be
a priority for now.
