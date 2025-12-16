<!-- markdownlint-disable -->
<p align="center">
    <!-- github-banner-start -->
    <img src="https://raw.githubusercontent.com/hotosm/drone-tm/main/docs/images/hot_logo.png" alt="HOTOSM Logo" width="25%" height="auto" />
    <!-- github-banner-end -->
</p>

<div align="center">
    <h1>Drone Tasking Manager</h1>
    <p>Community-driven drone imagery generation.</p>
    <p>Together, We Map.</p>
    <a href="https://github.com/hotosm/drone-tm/releases">
        <img src="https://img.shields.io/github/v/release/hotosm/drone-tm?logo=github" alt="Release Version" />
    </a>
</div>

</br>

<!-- prettier-ignore-start -->
<div align="center">

| **CI/CD** | | [![Build and Deploy](https://github.com/hotosm/drone-tm/actions/workflows/build_and_deploy.yml/badge.svg?branch=main)](https://github.com/hotosm/drone-tm/actions/workflows/build_and_deploy.yml?query=branch%3Amain) [![Publish Docs](https://github.com/hotosm/drone-tm/actions/workflows/docs.yml/badge.svg?branch=main)](https://github.com/hotosm/drone-tm/actions/workflows/docs.yml) [![pre-commit.ci status](https://results.pre-commit.ci/badge/github/hotosm/drone-tm/main.svg)](https://results.pre-commit.ci/latest/github/hotosm/drone-tm/main) |
| :--- | :--- | :--- |
| **Tech Stack** | | ![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi) ![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB) ![Postgres](https://img.shields.io/badge/postgres-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white) ![Kubernetes](https://img.shields.io/badge/kubernetes-%23326ce5.svg?style=for-the-badge&logo=kubernetes&logoColor=white) ![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white) |
| **Code Style** | | [![Backend Style](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/format.json&labelColor=202235)](https://github.com/astral-sh/ruff) [![Frontend Style](https://img.shields.io/badge/code%20style-prettier-F7B93E?logo=Prettier)](https://github.com/prettier/prettier) [![pre-commit](https://img.shields.io/badge/pre--commit-enabled-brightgreen?logo=pre-commit&logoColor=white)](https://pre-commit.com) |
| **Community** | | [![Slack](https://img.shields.io/badge/Slack-Join%20the%20community!-d63f3f?style=for-the-badge&logo=slack&logoColor=d63f3f)](https://slack.hotosm.org) |
| **Other Info** | | [![docs](https://github.com/hotosm/field-tm/blob/dev/docs/images/docs_badge.svg?raw=true)](https://docs.drone.hotosm.org) [![license](https://img.shields.io/github/license/hotosm/drone-tm.svg)](https://github.com/hotosm/drone-tm/blob/main/LICENSE.md) [![license-translations](https://img.shields.io/badge/license-CC%20BY%204.0-orange.svg)](https://github.com/hotosm/drone-tm/blob/main/src/frontend/messages/LICENSE.md) |

</div>

---

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

**DroneTM** is an integrated digital public good solution designed to harness
the power of the crowd to generate high-resolution aerial maps of any location.

This innovative platform provides drone pilots, particularly in developing
countries, with job opportunities while contributing to the creation of
high-resolution datasets crucial for disaster response and community resilience.

## Problem Statement

In low-income and disaster-prone areas, the accessibility to near real-time satellite datasets is severely restricted. High-resolution satellite imagery, when available, is often prohibitively expensive and outdated. Full-scale aircraft mapping is not a viable option due to its high costs and operational complexity. Traditional mapping solutions, relying on professional consultants with expensive equipment, often result in delays and lack of locally relevant data. Existing drone operation tools are mostly proprietary and not designed for large-scale collaborative efforts, limiting their effectiveness for community-driven projects.

## Solution

**DroneTM** offers a solution to these challenges by empowering communities to utilize drones for immediate and locally relevant mapping needs. Our platform:

- Provides a user-friendly, inclusive application enabling anyone with a drone, including inexpensive consumer or DIY drones, to contribute to a global repository of free and open aerial imagery.
- Facilitates community-driven drone operations, ensuring immediate response and responsible mapping that considers local needs.
- Coordinates aerial survey activities among multiple pilots through an open-source tasking platform, incorporating tools and processes to ensure coordinated flight plans for effective imagery acquisition.
- Offers a seamless pipeline for processing and dissemination of the collected imagery.

## Vision

Our vision is to create a platform that is not only accessible and user-friendly but also inclusive, enabling widespread participation in creating high-resolution aerial maps. By leveraging the power of community-operated drones, we aim to build a resilient and responsive solution that addresses the needs of low-income and disaster-prone areas.

## Features

1. **Crowdsourced Mapping**: Empower drone pilots to contribute to a global imagery repository.
2. **Community-Driven Operations**: Enable communities to use drones for immediate and locally relevant mapping.
3. **Open-Source Platform**: Coordinate aerial surveys with an open-source tasking platform.
4. **Seamless Pipeline**: Ensure smooth processing and dissemination of imagery data.
5. **User-Friendly Application**: Designed for ease of use, allowing even non-professional pilots to contribute.

### Supported Drones

To see a list of supported and unsupported drones, please visit
the [FAQ](https://docs.drone.hotosm.org/about/faq/#q-what-drones-are-supported) page.

## Getting Started

To get started with DroneTM:

1. **Sign Up**: Create an account and join our community of project creators and drone pilots.
2. **Create Projects**: Sign up as a project creator to define Area for mapping.
3. **Start Mapping**: Sign up as a drone pilots to use your drone to capture imagery and contribute to our global repository.

## Roadmap

<!-- prettier-ignore-start -->
| Status | Feature | Release |
|:------:|:-------:|:--------|
|✅| 🖥️ simple UI with user sign up and login | Since [v2024.11.0][1] |
|✅| 🖥️ project area subdivision into smaller task areas for operators | Since [v2024.11.0][1] |
|✅| 📱 flight plan generation in task areas for DJI drones | Since [v2024.11.0][1] |
|✅| 🖥️ upload of drone imagery collected during flight | Since [v2024.11.0][1] |
|✅| 📱 follow terrain during flight plan generation in hilly/mountainous regions | Since [v2025.3.1][3] |
|✅| 🖥️ merging of drone imagery into a final combined image for the project | Since [v2024.11.0][1] |
|✅| 📱 flight plans working on DJI Mini 4 Pro, Air 3, and Mavic 3 | Since [v2024.11.0][1] |
|✅| 📱 upload flight plan to drone via mobile app (no laptop required) | Since [v2025.3.1][3] |
|✅| 🖥️ precise georeferencing of final imagery using Ground Control Points | Since [v2024.11.0][1] |
|✅| 🖥️ automated Digital Elevation Model inclusion (no manual upload required) | Since [v2024.11.0][1] |
|✅| 🖥️ automated uploading of final imagery to OpenAerialMap (+ credit to user that uploads) | Since [v2025.3.1][3] |
|✅| 📱 allow adjustments to the flight plan orientation based on field conditions | Since [v2025.1.0][2] |
|✅| 📱 flight plans working on Potensic Atom 2 | Since [v2025.4.0][4] |
|✅| 📱 improved experience copying flightplans onto controllers (via WebADB) | Since [v2025.4.0][4] |
|✅| 🖥️ flightplan generation in Litchi CSV and QGroundControl .plan formats | TBC |
|⚙️| 🖥️ support retries for dropped connections during photo uploads | |
|⚙️| 🖥️ separate workflows for processing individual images vs batch processing in ODM | |
|⚙️| 📱 capture of imagery at multiple (configurable) angles from the drone camera | |
|⚙️| 📱 entirely offline flightplan generation, directly on device | |
| | 📱 allow modification and division of flightplans by user before flight | |
| | 🖥️ pre-filtering and validation of obvious photo issues prior to upload | |
| | 🖥️ user access management for each part of the UI | |
| | 🖥️ improved user feedback and retry capabilities during imagery processing | |
| | 🖥️ access to alternative high quality terrain models such as Copernicus GLO-30 | |
| | 📱 & 🖥️ real-time notifications for drone flight progress & task status | |
|⚙️| 🖥️ scaling of ODM imagery processing to hundreds of images in parallel | |
| | 🖥️ better usage of 3D model data collected by drones | |
| | 📱 HOT community mapping drone: cheap, mapping optimized, materials sourced locally | |
<!-- prettier-ignore-end -->

> [!Note]
> 📱 for mobile / operators
>
> 🖥️ for desktop / managers / validators

## Drone Support

We currently recommend the **DJI Mini 5 Pro** or **Mini 4 Pro**, as the
drones with the best waypoint support, and high quality cameras on board.

For now, all other drones have a compromise of some kind.

<!-- prettier-ignore-start -->
| Drone | <250g | Waypoint Files | SDK Available | External Tools With Support |
|:------:|:-------:|:-------:|:-------:|:--------|
| DJI Mini 5 Pro | ✅ | ✅ | ❌ | None |
| DJI Mini 4 Pro | ✅ | ✅ | ✅ | Litchi Pilot Beta, DroneDeploy |
| DJI Mini 3 Pro | ✅ | ✅ | ✅ | Litchi Pilot Beta |
| DJI Air 3/3S | ❌ | ❔ | ❌ | None |
| DJI Mavic 3/3P/3C | ❌ | ❔ | ❌ | None |
| DJI Mini 3 | ✅ | ❌ | 🤔 | Litchi Pilot Beta |
| DJI Mavic Air/Pro  | ❌ | ❔ | ✅ | Litchi, DroneDeploy |
| DJI Mini 4k | ✅ | ❔ | ❌ | None |
| DJI Mini SE (version 1 only) | ✅ | ❌ | ✅ | Litchi |
| DJI Mini 2 | ✅ | ❌ | ✅ | Litchi |
| DJI Air 2S | ❌ | ❔ | ✅ | Litchi, DroneDeploy |
| Potensic Atom 2 | ✅ | 🤔 | ❌ | None |
<!-- prettier-ignore-end -->

> [!Note]
> ❔ in theory should work, but untested in the field
>
> 🤔 works with some limitations, such as lack of terrain following

## Contribution

DroneTM is an open-source project, and we welcome contributions from the community. Whether you're a developer, a drone pilot, or just passionate about mapping, you can get involved:

- **Fork the Repository**: https://github.com/hotosm/drone-tm
- **Report Issues**: https://github.com/hotosm/drone-tm/issues
- **Contribute Code**: Submit pull requests for new features or bug fixes.

Join us in transforming aerial mapping through community-powered drones and create a resilient future for all.

[1]: https://github.com/hotosm/drone-tm/releases/tag/v2024.11.0
[2]: https://github.com/hotosm/drone-tm/releases/tag/v2025.1.0
[3]: https://github.com/hotosm/drone-tm/releases/tag/v2025.3.1
[4]: https://github.com/hotosm/drone-tm/releases/tag/v2025.4.0
