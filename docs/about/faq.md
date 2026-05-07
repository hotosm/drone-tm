# ❓ Frequently Asked Questions ❓

## General

### Q. Why should I consider DroneTM over other options?

As of 2025 there are 3 basic options for drones:

1. ~$20,000 and up professional fixed-wing mapping platform
   like a Sensefly Ebee or Wingtra One.
2. ~$4,000-$10,000 enterprise quadcopter Like a DJI Mavic
   Enterprise, Autel Evo, or DJI Matrice.
3. ~$1,000 micro-quadcopter like a DJI Mini 4 Pro.

#### Option 1: Expensive Route (Consultant)

If you have an expensive operator and want to go big (thousands of km² or more)
and don't mind a lot more administrative hassles, permissions, and are willing
to climb a learning curve, get a Sensefly Ebee or Wingtra One, which come with
dedicated laptop-based planning suites to generate mapping flight missions.

#### Option 2: Mid-Level Cost (DIY Paid Software)

If you have a moderately expensive operator, but still not looking to get into
industrial-scale mapping, you get something like a Mavic Enterprise, and use it
with a commercial flight planning software like DroneDeploy.

This works pretty well (you still might want to use our Drone Tasking Manager to
coordinate flight plans if you have more than one, but at least you can generate
good mapping flight plans with commercial software).

#### Option 3: Low-Cost Community-Driven (Drone-TM)

We usually recommend the DJI Mini 4 Pro for local communities; it's by a
substantial margin the best value for money in terms of image quality per dollar
(from currently available drones). The "Fly More Combo" retails for USD$1050
and comes with 3 batteries and a controller, so you can fly fairly consistently
throughout the day straight after unboxing.

It has some major advantages:

- It's less than 250 grams, so it's very lightly regulated in many countries;
  in many places you don't need an operators licence, and often things like
  flight ceilings don't apply to micro-drones.
- It has a remarkably good camera, creating imagery that rivals much more
  expensive drones.
- It's surprisingly stable in the wind despite its small size.
- It's really cheap (USD$1050 for the Fly More Combo, ~$750 for the drone with
  only 1 battery and basic controller) and widely available.
- It's easy to get serviced because it's a very popular consumer drone.

However, the Mini 4 Pro has 2 main drawbacks:

1. It doesn't work with most mapping mission planning software suites (because
   DJI has still not released an SDK for it, despite claiming they intended to do so).
2. It's not the fastest flyer, so it can't cover the amount of area that a more
   expensive drone can do in a day.

For the former drawback, we specifically developed our
[Drone Tasking Manager](https://drone.hotosm.org) to work well with the Mini 4 Pro because it's
such an effective, accessible, and affordable option for communities. As far as we
know our DroneTM is the only way to use the Mini 4 Pro for serious professional
mapping, but it does work, and it actually works pretty well.

But be warned; you'd still be investing in a drone for which only our solution
really permits professional mapping. Our solution is open source and free to
use: no "freemium" licensing whereby you only get a limited functionality.

It's a Digital Public Good and we're not trying to make money off it, we're
trying to empower communities with it.

For the latter drawback, it's really a question of who is flying. If it's a
highly-paid person who travels away from home to cover a given area, you want
a larger, faster drone to cover more area per day (you can cover 1-4 km² per
day at 5cm GSD with good enough overlap for decent 3D using a Mini 4 Pro, whereas
you can cover >20km²/day with a Sensefly Ebee or Wingtra One - but those are $20,000
instead of $1050).

If it's local community members flying relatively close to home, it can be much more
cost effective using a small fleet of cheaper drones like the Mini 4 Pro (plus it
helps the local economy and people).

### Q. What problem do we solve with DroneTM?

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

### Q. Can drones be weaponized? Is DroneTM technology a security risk?

When people hear "drone attack" in the news, they are generally thinking of large
military unmanned aerial vehicles - a completely different technology to what we
use.

**Weight is the key distinction.** Civil aviation authorities worldwide use
250 grams as the threshold separating micro-drones (essentially a flying camera)
from larger, potentially hazardous aircraft. The drones we operate - primarily
the DJI Mini 4 Pro at 249g - fall below this threshold. At that weight:

- The motors are too small to carry meaningful payloads. A grenade alone weighs
  over 400g; a DJI Mavic 3 (895g) has been cited in security literature as
  capable of carrying one. A DJI Mini 4 Pro cannot.
- A drone this light falling from the sky cannot normally cause more than trivial
  injury or property damage - and consumer drones actively resist uncontrolled
  descent: they return home automatically on low battery, follow a failsafe
  routine if the signal drops (including jamming attempts), and carry
  obstacle-avoidance sensors that brake before impact.
- Many jurisdictions require no special operator certification for sub-250g drones,
  precisely because regulators treat them as low-risk consumer devices.

**What about reconnaissance?** This is a more nuanced concern. Even a lightweight
mapping drone can theoretically be used for intelligence gathering. DroneTM
addresses this through radical transparency: our platform can be used to share
automated flight paths with civil aviation authorities, so regulators know
exactly where every drone will fly before it does so. Where sensitive areas are
involved, we exclude them from flight plans entirely, or - if applicable to
the context being flown - fly those areas under direct authority supervision and
reduce the resolution of the resulting data to levels comparable to commercial
satellite imagery.

**Our community-first approach** is a further safeguard. Every project involves
extensive stakeholder engagement and community participation. We maintain a strict
neutral stance and do not partner with military actors as clients or operators.
Even in conflict-prone areas, arriving with a tiny DJI Mini and demonstrating the
transparent, participatory nature of the work has consistently secured acceptance
from communities and authorities alike.

In short: the drones we use are not weapons, and our platform is designed so you
don't have to take that on faith.

---

### Q. How do I get started with DroneTM?

You can contribute to DroneTM in multiple ways:

1. If you have a DJI Mini 4 Pro drone, you can choose nearby projects, capture images, and upload them.
2. If you need drone imagery for your locality, you can create a project with the necessary details.
3. If you're a developer, you can fork the project and contribute
   to its development. We encourage starting with tickets labeled as “good first issue.”

---

### Q. What are the outputs I get from DroneTM? Are they raw drone imagery or the processed data like orthophotos and surface models?

Currently, only processed data is available for download. The final outputs include:

- **2D Orthophoto**: a birdseye view of your area (like a high resolution satellite image).
- **3D Point Cloud**: this can be used to generate Digital Terrain / Surface Models.

---

### Q. Do I need an OSM account or need to create a new account to contribute to DroneTM?

No, you don't need an OSM account. You can simply sign up using your Google account.
We could add other login providers on request / over time too.

---

### Q. What if the project area of my project is large and needs multiple flight operations?

DroneTM divides large project areas into multiple tasks, allowing you to adjust the area per task.
**Note:** The maximum project area allowed is 100 sq. km.

---

### Q. What if my project creation contains no-fly zones?

During project creation, you can specify that the project area includes
no-fly zones. There is a feature to draw these zones on the project map, and the flight plan will exclude any specified no-fly zones.

---

### Q. What Drones Are Supported?

See [here](https://github.com/hotosm/Drone-TM/#drone-support) for an up to date
list of supported drones.

Users can also download the **GeoJSON** of the task area and load it into their drone
flight planning software to upload to their Drone.

!!! note

      We have a few angles to improve drone support.

      See
      [this document](https://docs.drone.hotosm.org/decisions/0002-flightplan-upload)
      for more information.

### Q. What Drones Are Not Supported?

We don't have an exhaustive list of all unsupported drones, but in general, if
the drone is not listed as supported, then DroneTM will probably not work with
it.

Our goal is to support affordable community mapping drones that ideally cost
less than 1000 USD, so support for expensive commercial drones will not be
a priority for now.

### Q. Isn't it risky capturing high resolution images that contain people?

Drone operators should always consider privacy when collecting imagery
that may include people, especially when publishing data to public platforms.

DroneTM's recommended default resolution is around 4 cm/pixel (GSD). At this
resolution, a human face (~15–20 cm wide) typically spans only 4–5 pixels,
which means faces are not reliably identifiable.

However, other contextual risks may still exist depending on the environment.
For example, imagery may reveal **personally identifiable assets** such as vehicles,
distinctive property features, or activities occurring on private property.

Before collecting imagery in areas where people may be present, operators
should **conduct a risk assessment appropriate to the local context and regulations**.

It is also important to implement **no-fly zones or restricted areas**, particularly
around critical infrastructure, military installations, or other sensitive locations.

If necessary, measures such as downsampling or blurring can be taken to protect
people's privacy or respect the sensitivity of specific areas. The
UAViators Humanitarian Code of Conduct and
[summary of best practices](http://uaviators.org/docs) can help guide decisions
on how to handle and share collected imagery.

The following risks are less of a concern for a typical DroneTM project:

- Reliable facial identification.
- Detailed behavioural tracking, as DroneTM projects typically involve
  infrequent data collection rather than continuous monitoring.

### Q. Why should we collect baseline imagery before a disaster?

Collecting high-quality baseline data before a disaster strikes is vitally
important. During the response to Tropical Cyclone Gita in Tonga (2018), having
collected baseline drone imagery only a few months before the cyclone proved
invaluable. It not only provided usable data for post-disaster comparison, thus
facilitating accurate damage assessments, but it also acted as a trial run for
the actual disaster, enabling the development of procedures, location of
suitable flight areas, and rectification of problems.

The baseline imagery was used for:

- **Crowdsourced building damage assessment** by comparing pre- and post-event
  imagery
- **Supporting the claims validation process** when homeowners repaired damage
  before government assessments took place
- **Quantifying damage and recovery needs** of school buildings for
  reconstruction planning

For any area at risk of natural disasters, establishing a routine of baseline
imagery collection means that when a disaster does occur, teams already know the
flight areas, have regulatory approvals in place, and have a comparison dataset
ready.

> _Adapted from: World Bank and Humanitarian OpenStreetMap Team (2019).
> Technical Guidelines for Small Island Mapping with UAVs.
> CC BY 4.0._

---

## Info For Drone Operators

### Help! I'm having trouble managing my collected imagery

- Sometimes you may have to deal with factors such as limited hard drive,
  space, unreliable hardware, and patchy internet.
- If you are worried about data loss, the best bet is to **backup** the data
  first, then perhaps have a data/project manager deal with the final
  upload and processing in DroneTM.
- There are a few options for uploading data.
- First of all, your project manager, or a contact at HOTOSM / NAXA should
  create an online accessible data bucket.
- On the technical side, they will need:
  - An S3 bucket with private permissions `some-bucket-name`.
  - An IAM user, with policy (note `s3:ListAllMyBuckets` is required
    unfortunately):

    ```json
    {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Action": [
            "s3:GetBucketLocation",
            "s3:ListBucket",
            "s3:GetObject",
            "s3:PutObject",
            "s3:DeleteObject"
          ],
          "Resource": ["arn:aws:s3:::some-bucket-name", "arn:aws:s3:::some-bucket-name/*"]
        },
        {
          "Effect": "Allow",
          "Action": "s3:ListAllMyBuckets",
          "Resource": "*"
        }
      ]
    }
    ```

  - A pair of security credentials for the IAM user.
    Access / Secret key pair.

#### Simple: Web UI Option

1. Access: [https://demo.filestash.app](https://demo.filestash.app)
2. Go to the 'S3' tab.
3. Click 'Advanced'.
4. Enter credentials:
   - Endpoint: <https://some-bucket-name.s3.amazonaws.com>
     - Replace `some-bucket-name` with the name provided by your manager.
   - Region: us-east-1
   - Access key: provided by manager
   - Secret key: provided by manager

5. Click connect.
6. Copy files across to this page and they will be safely stored.

#### Advanced: RClone

This is more stable and the preferred approach if you can do this.

**1. Install rclone**

Windows:

- Download: https://rclone.org/downloads/
- Download **Windows (64-bit)**
- Extract the zip
- Open the extracted folder
- In the address bar, type `cmd` and press Enter

Linux:

```bash
curl https://rclone.org/install.sh | sudo bash
```

**2. Configure rclone**

```bash
rclone config

# Then enter:
n
s3upload
s3
AWS
false
<PASTE_ACCESS_KEY>
<PASTE_SECRET_KEY>
us-east-1
[press Enter]
[press Enter]
private
n

# Exit config when finished.

# Test connection:
rclone lsd s3upload:
```

**3. Upload Files**

```bash
# Windows
rclone copy "C:\Path\To\FolderName" s3upload:BUCKET_NAME/FolderName --progress --transfers 1 --s3-upload-concurrency 1 --retries 10

# Linux
rclone copy /path/to/foldername s3upload:BUCKET_NAME/foldername --progress --transfers 1 --s3-upload-concurrency 1 --retries 10
```

**If the internet disconnects**:

- Just run the same upload command again.
- It will resume automatically.

#### Other Options

There are a few tools to mount an S3 bucket as a Windows drive:

- [s3drive](https://www.callback.com/s3drive) offers free personal usage.
- [cloudmounter](https://cloudmounter.net) is paid software.

There is also [CyberDuck](https://cyberduck.io), a nice GUI tool also with
a drag-and-drop interface for copying files to S3.

#### Final Steps

- Your manager, or contact at HOTOSM / NAXA will take it from here!
- Your imagery is safely backed up online, so can now be processed
  and made available in DroneTM.
