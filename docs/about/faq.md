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
[Drone Tasking Manager](dronetm.org) to work well with the Mini 4 Pro because it's
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
you can cover >20km²/day with a Sensefly Ebee or Wingtra One—but those are $20,000
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

No, you don’t need an OSM account. You can simply sign up using your Google account.
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

Currently, DroneTM is tested on **DJI Mini 4 Pro**, and flight plans are optimized for its camera specifications.
However, the system is compatible with any DJI drones that support waypoint features, such as:

- **Mavic 3/3P/3C**
- **Air 3/3S**
- **Mini 4 Pro**

Users can also download the **GeoJSON** of the task area, load it into their
drones, and create custom flight plans as per the specifications provided by the project creator.

!!! note

      We have two angles to increase the number of supported drones:

      1. Support for interfacing with flight plan software such as DroneDeploy,
      Litchi, DroneLink, meaning any drone supported there is supported by
      DroneTM.

      2. Support for Open-Source flight plan software such as ArduPilot and iNAV,
      widening our support signficantly to cheap custom-made drones, and in future
      the HOT mapping drone.

### Q. What Drones Are Not Supported?

We don't have an exhaustive list of all unsupported drones, but in general, if
the drone is not listed as supported, then DroneTM will probably not work with
it.

Our goal is to support affordable community mapping drones that ideally cost
less than 1000 USD, so support for expensive commercial drones will not be
a priority for now.

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
          "Resource": [
            "arn:aws:s3:::some-bucket-name",
            "arn:aws:s3:::some-bucket-name/*"
          ]
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

- Endpoint: https://some-bucket-name.s3.amazonaws.com
  - Replace `some-bucket-name` with the name provided by your manager.
- Region: us-east-1
- Access key: provided by manager
- Secret key: provided by manager

5. Click connect.
6. Copy files across to this page and they will be safely stored.

#### Advanced: RClone

- Install RClone on your machine:

  ```bash
  sudo -v ; curl https://rclone.org/install.sh | sudo bash
  mkdir -p ~/.config/rclone
  ```

- Add the details provided by your manager, either via the rclone
  config command, or using:

  ```bash
  BUCKET_NAME=some-bucket-name
  ACCESS_KEY=xxx
  SECRET_KEY=xxx
  cat <<EOF > ~/.config/rclone/rclone.conf
  [s3-bucket]
  type = s3
  provider = AWS
  access_key_id = ${ACCESS_KEY}
  secret_access_key = ${SECRET_KEY}
  endpoint = https://${BUCKET_NAME}.s3.amazonaws.com
  region = us-east-1
  acl = private
  EOF
  ```

- Copy files from your system into the bucket:

  ```bash
  rclone sync \
     /path/to/imagery_directory \
     s3-bucket:imagery_directory_plus_timestamp
  ```

#### Final Steps

- Your manager, or contact at HOTOSM / NAXA will take it from here!
- Your imagery is safely backed up online, so can now be processed
  and made available in DroneTM.
