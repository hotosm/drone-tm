# Image Quality Checks

When you upload drone images, Drone-TM checks each one before adding it to a
task. Images that fail the checks are flagged for review.

## Why an Image Can Be Rejected

An image is rejected if any of the following is true:

- It is missing camera information (EXIF).
- It is missing GPS location, or the location is invalid.
- The camera was not pointing down enough (gimbal angle).
- The image is too blurry.
- The image is too dark (almost all black, e.g. lens cap on).
- The image is too bright (almost all white, e.g. over-exposed from the sun).
- The image could not be downloaded or checked.

If an image passes all the checks but its GPS location is not inside any task
area, it is marked **Unmatched** (not rejected).

## Image Statuses

Each image has one status:

| Status           | Meaning                                      |
| ---------------- | -------------------------------------------- |
| **Assigned**     | Passed the checks and added to a task.       |
| **Rejected**     | Failed a quality check, or rejected by hand. |
| **Invalid EXIF** | Missing camera or GPS information.           |
| **Unmatched**    | Good image, but outside all task areas.      |
| **Duplicate**    | The same image was already uploaded.         |

## How to Override a Rejection

Open the **Image Review** page for your project. Click an image to see why it
was rejected, then choose one of these actions:

- **Override rejection** - Use this when a rejected image is actually fine and
  you want to keep it. Drone-TM will try to place it in a task using its GPS
  location.
  - If the image has no GPS, the override will not work.
  - If the GPS is outside every task area, the image becomes **Unmatched**.
- **Match to task** - Use this for **Unmatched** images. Pick the task on the
  map that the image belongs to. This skips the GPS check.
- **Reject image** - Use this to remove an image that was assigned but should
  not be used.

### Doing Many Images at Once

You can select several images by drawing a box on the map:

- **Override rejection** works on any rejected images you select.
- **Assign to task** works only on **Unmatched** images. Rejected images must
  be overridden first before they can be assigned this way.
