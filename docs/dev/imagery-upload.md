# Imagery Upload Workflow

In late 2025 we worked with a contractor to improve the imagery
upload workflow.

The full discussion and plan can be
[seen here](https://github.com/hotosm/drone-tm/discussions/635).

The implemented workflow has been summarised by Opus 4.6 LLM
as of 12/02/2026.

## Overview

The imagery upload pipeline has five major phases:

1. **Upload** – Browser uploads images via S3 multi-part resumable uploads.
2. **Ingest** – An ARQ background worker processes each image
   (hash, EXIF, thumbnail, duplicate check) and writes a record to
   `project_images`.
3. **Classify** – A batch classification job checks image quality
   (sharpness, exposure, gimbal angle), validates GPS, and assigns
   each image to a task area.
4. **Review** – The user reviews classified images per-task, can
   accept/reject/delete individual images, mark tasks as verified
   ("fully flown"), and inspect coverage on a map.
5. **Process** – Verified tasks have their images moved from the
   staging directory to per-task S3 folders, then ODM processing
   is triggered.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        IMAGERY UPLOAD PIPELINE                      │
└─────────────────────────────────────────────────────────────────────┘

┌──────────┐    ┌──────────────┐    ┌────────────┐    ┌────────┐    ┌──────────┐
│  Upload  │──▶│    Ingest    │───▶│  Classify  │──▶│ Review │─-─▶│ Process  │
│ (Browser)│    │ (ARQ Worker) │    │(ARQ Worker)│    │ (User) │    │(ARQ→ODM) │
└──────────┘    └──────────────┘    └────────────┘    └────────┘    └──────────┘

 S3 multi-part   Hash + EXIF +       Quality +        Accept /      Move files
 resumable       thumbnail +         GPS match        reject /      to task dirs
                 duplicate check     to task area      verify        + ODM
```

## `project_images` Table

For each project, the `project_images` table records every uploaded
image. Key fields:

| Column             | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| `id`               | Primary key (UUID)                               |
| `project_id`       | FK to `projects`                                 |
| `task_id`          | FK to `tasks` (set during classification)        |
| `filename`         | Original filename                                |
| `s3_key`           | Current S3 object key                            |
| `hash_md5`         | MD5 hash for duplicate detection                 |
| `batch_id`         | Groups images uploaded together (UUID)           |
| `location`         | PostGIS POINT (SRID 4326) from EXIF GPS          |
| `exif`             | Full EXIF/XMP metadata as JSONB                  |
| `uploaded_by`      | User ID (Google OAuth string)                    |
| `uploaded_at`      | Timestamp of record creation                     |
| `classified_at`    | Timestamp when classification ran                |
| `status`           | Current image status (see below)                 |
| `rejection_reason` | Human-readable explanation when rejected/invalid |
| `sharpness_score`  | Laplacian variance (higher = sharper)            |
| `duplicate_of`     | FK to original `project_images.id` if duplicate  |
| `thumbnail_url`    | S3 key for the 200×200 JPEG thumbnail            |

### Image Statuses

| Status         | Meaning                                                         |
| -------------- | --------------------------------------------------------------- |
| `staged`       | Uploaded and ingested; awaiting classification                  |
| `uploaded`     | Legacy / unused (default in DB column, not actively set)        |
| `classifying`  | Classification is currently running on this image               |
| `assigned`     | Passed all quality checks and matched to a task area            |
| `rejected`     | Failed quality checks (blur, gimbal angle, exposure, tail)      |
| `unmatched`    | Valid image but GPS coordinates don't fall in any task boundary |
| `invalid_exif` | EXIF data is missing, unreadable, or GPS is out of range        |
| `duplicate`    | Same MD5 hash as an existing image in the project               |

## Phase 1 — Upload (S3 Multi-Part Resumable)

Each image is uploaded from the browser using the S3 multi-part upload
protocol. This allows resumable uploads of large drone images and
avoids the backend having to proxy the file bytes.

### S3 Path Convention

- **Staging** (`staging=True`):
  `projects/{project_id}/user-uploads/{filename}`
- **Direct to task** (`staging=False`, requires `task_id`):
  `projects/{project_id}/{task_id}/images/{filename}`

The staging path is used by the new batch workflow. The direct-to-task
path is the original behaviour.

### API Endpoints (all under `/api/projects/`)

1. **`POST /initiate-multipart-upload/`**
   - Input: `project_id`, `file_name`, optional `task_id`, `staging` flag.
   - Calls `s3.initiate_multipart_upload()` to get an `upload_id`.
   - Returns `upload_id` + `file_key`.

2. **`POST /sign-part-upload/`**
   - Input: `upload_id`, `file_key`, `part_number`, optional `expiry`.
   - Generates a presigned URL for the client to `PUT` the chunk
     directly to S3.
   - Returns presigned `url` + `part_number`.

3. **`GET /list-parts/`** _(for resume)_
   - Input: `upload_id`, `file_key`.
   - Lists already-uploaded parts so the client knows which chunks to
     skip on resume.

4. **`POST /complete-multipart-upload/`**
   - Input: `upload_id`, `file_key`, `parts` (with `PartNumber` /
     `ETag`), `project_id`, `filename`, optional `batch_id`.
   - Finalises the multi-part upload in S3.
   - Enqueues an ARQ job `process_uploaded_image` (deferred by 2 s for
     S3 eventual consistency).
   - Returns `file_key` + `job_id`.

5. **`POST /abort-multipart-upload/`**
   - Input: `upload_id`, `file_key`.
   - Aborts the upload and cleans up parts in S3.

### Sequence

```
 Browser                        Backend API                 S3 / MinIO
 ───────                        ───────────                 ──────────
   │  POST /initiate-multipart-upload/  │                       │
   │ ──────────────────────────────────▶│  create_multipart()   │
   │                                    │──────────────────────▶│
   │          { upload_id, file_key }   │◀──────────────────────│
   │◀────────────────────────────────── │                       │
   │                                    │                       │
   │  POST /sign-part-upload/           │                       │
   │   (for each chunk)                 │                       │
   │ ──────────────────────────────────▶│  presign_url()        │
   │          { url, part_number }      │──────────────────────▶│
   │◀────────────────────────────────── │◀──────────────────────│
   │                                    │                       │
   │  PUT <presigned_url>  ─────────────────────────────────────▶│
   │          (upload chunk bytes)      │                       │
   │◀──────────────────────── { ETag } ─────────────────────────│
   │                                    │                       │
   │  POST /complete-multipart-upload/  │                       │
   │   { parts: [{PartNumber, ETag}] }  │                       │
   │ ──────────────────────────────────▶│  complete_multipart() │
   │                                    │──────────────────────▶│
   │                                    │   enqueue ARQ job     │
   │          { file_key, job_id }      │   (2s defer)          │
   │◀────────────────────────────────── │                       │
```

## Phase 2 — Ingest (`process_uploaded_image` ARQ Task)

Each completed upload triggers an individual background job.
Jobs are isolated: if one image has corrupt EXIF, others are
unaffected.

### Pipeline Steps

1. **Download from S3** — fetch the file bytes using the `file_key`.
2. **Calculate MD5 hash** — `hashlib.md5` of the full file content.
3. **Duplicate check** — query `project_images` for an existing row
   with the same `hash_md5` in the same project.
   - If duplicate found → save record with `status=duplicate`,
     `duplicate_of=<original_id>`, skip remaining steps.
4. **Extract EXIF** — uses `pyexiftool` (requires the `exiftool`
   binary in the container). Extracts all EXIF/XMP tags including
   DJI-specific fields (gimbal angle, yaw, altitude, etc.).
   - GPS coordinates are extracted and validated (must be in
     ±90°/±180° range).
   - If EXIF is missing or GPS is invalid → `rejection_reason` is
     set and status will be `invalid_exif`.
5. **Generate thumbnail** — creates a 200×200 JPEG thumbnail using
   PIL/Pillow, uploads it to S3 at a `/thumbnails/` sub-path.
   Failure is non-fatal.
6. **Determine status** — `invalid_exif` if no EXIF or GPS error,
   otherwise `staged`.
7. **Save record** — always inserts a `project_images` row regardless
   of outcome, so the UI can show every upload attempt.

```
process_uploaded_image (ARQ)
│
├─ Download file from S3
├─ Calculate MD5 hash
├─ Duplicate? ──▶ Save with status=DUPLICATE, stop
│
├─ Extract EXIF + GPS
│   ├─ No EXIF / bad GPS ──▶ rejection_reason set
│   └─ Valid EXIF + GPS ──▶ location stored as PostGIS POINT
│
├─ Generate 200×200 thumbnail ──▶ Upload to S3 (best-effort)
│
├─ Status = invalid_exif | staged
│
└─ INSERT into project_images (always)
```

## Phase 3 — Classify (`classify_image_batch` ARQ Task)

Classification is triggered by the user after all images in a batch
have been ingested. It runs as a single ARQ job.

### Triggering

`POST /api/projects/{project_id}/classify-batch/`

- Checks that `staged` images exist for the given `batch_id`.
- Enqueues `classify_image_batch` on the default ARQ queue.

### Classification Pipeline

The classifier processes all `staged` images in the batch using
`SELECT ... FOR UPDATE SKIP LOCKED` to avoid race conditions.

Each image is classified in parallel (up to 6 concurrent workers,
configurable via `CLASSIFICATION_CONCURRENCY`) with per-image
timeouts (120 s default).

For each image:

1. **Skip pre-rejected** — if already `rejected` or `invalid_exif`
   from ingest, preserve that status.
2. **Check EXIF** — must have EXIF data.
3. **Validate GPS** — must have valid lat/lon in range.
4. **Parse drone metadata** — extract `UserComment` JSON for
   DJI-specific fields.
5. **Check gimbal pitch** — `GimbalPitchDegree` must be ≤ -20°
   (camera pointing down). Only gimbal pitch is checked, not
   aircraft pitch.
6. **Download image from S3** — only if no critical issues found so
   far (optimisation to avoid unnecessary downloads).
7. **Check sharpness** — Laplacian variance method. Score must be
   ≥ 100.
8. **Check exposure** — detects lens-cap (mostly black), overexposed
   (mostly white), and low dynamic range images.
9. **AOI sanity check** — if image is > 100 km from project centroid,
   flag as likely wrong project.
10. **Match to task** — `ST_Intersects` of the image's GPS point
    against task boundary polygons.
    - Match found → `status=assigned`, `task_id` set.
    - No match → `status=unmatched`.

### Quality Thresholds

| Check             | Threshold                     | Rejection reason                   |
| ----------------- | ----------------------------- | ---------------------------------- |
| Gimbal pitch      | > -20° (not pointing down)    | "Camera must point down"           |
| Sharpness         | Laplacian variance < 100      | "Blurry"                           |
| Mostly black      | mean ≤ 40 & std ≤ 15          | "Lens cap or severe underexposure" |
| Mostly white      | mean ≥ 215 & std ≤ 15         | "Overexposed / blown highlights"   |
| Low dynamic range | 90%+ pixels below/above limit | Exposure issues                    |
| GPS missing       | No lat/lon                    | "Missing GPS location data"        |
| GPS out of range  | > ±90°/±180°                  | "Invalid GPS coordinates"          |
| Far from project  | > 100 km from centroid        | "Likely wrong project"             |

### Post-Classification: Flight Tail Removal

After classification assigns images to tasks, a flight tail detection
step runs **per task area** within the batch:

- Analyses the flight trajectory using image timestamps, GPS
  positions, and azimuths.
- Identifies takeoff and landing tails (images captured while the
  drone transits to/from the flight area).
- Uses azimuthal shift analysis with 5-image look-ahead/behind
  confirmation windows.
- Marks tail images as `rejected` with reason
  "Flight tail detection: flightplan transit".
- Safety cap: won't reject more than 25% of a segment.
- Only runs on segments with ≥ 20 images.

```
classify_image_batch (ARQ)
│
├─ SELECT staged images FOR UPDATE SKIP LOCKED
├─ Fetch project centroid (for AOI sanity check)
│
├─ For each image (parallel, max 6):
│   ├─ Set status = classifying
│   ├─ Skip if pre-rejected from ingest
│   ├─ Check EXIF exists
│   ├─ Validate GPS coordinates
│   ├─ Check gimbal pitch (≤ -20°)
│   ├─ Download image from S3 (only if no issues yet)
│   ├─ Check sharpness (Laplacian variance ≥ 100)
│   ├─ Check exposure (black/white/dynamic range)
│   ├─ If issues → status = rejected | invalid_exif
│   └─ If clean → ST_Intersects to find task
│       ├─ Match → status = assigned, task_id set
│       └─ No match → status = unmatched
│
└─ Post-classification: flight tail removal (per task)
    └─ Reject transit images at start/end of flight
```

## Phase 4 — Review

After classification, the user reviews results through several
endpoints under `/api/projects/`:

| Endpoint                                                          | Purpose                                                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| `GET /{project_id}/batch/{batch_id}/status/`                      | Status counts by category                                   |
| `GET /{project_id}/batch/{batch_id}/images/`                      | All images with presigned URLs (supports polling)           |
| `GET /{project_id}/batch/{batch_id}/review/`                      | Images grouped by task with verification status             |
| `GET /{project_id}/batch/{batch_id}/map-data/`                    | Task polygons + image points as GeoJSON (for map)           |
| `GET /{project_id}/batch/{batch_id}/task/{task_id}/verification/` | Task images, geometry, and coverage %                       |
| `POST /{project_id}/images/{image_id}/accept/`                    | Re-classify a rejected image (re-runs task matching)        |
| `DELETE /{project_id}/images/{image_id}/`                         | Delete a single image                                       |
| `DELETE /{project_id}/batch/{batch_id}/`                          | Delete entire batch (S3 + DB, runs in background)           |
| `POST /{project_id}/tasks/{task_id}/mark-verified/`               | Mark task as "fully flown" (inserts `IMAGE_UPLOADED` event) |

### Task Verification

When the user is satisfied that a task has sufficient coverage, they
mark it as verified. This inserts a `task_events` row with state
`IMAGE_UPLOADED`. Only verified tasks proceed to processing.

Coverage is estimated by buffering each image point by 20 m and
calculating the intersection area with the task polygon.

## Phase 5 — Process (`process_batch_images` ARQ Task)

Processing is triggered by:

`POST /api/projects/{project_id}/batch/{batch_id}/process/`

This enqueues `process_batch_images` which:

1. **Move images** — for each `assigned` image in verified tasks
   (those with `IMAGE_UPLOADED` state), copies the file in S3 from:
   - `projects/{project_id}/user-uploads/{filename}`
   - → `projects/{project_id}/{task_id}/images/{filename}`
   - Updates the `s3_key` in the database to the new location.

2. **Trigger ODM** — for each task that has ≥ 3 images (minimum for
   overlapping photogrammetry), enqueues a `process_drone_images`
   ARQ job.

3. **Processing status** — available via:
   `GET /{project_id}/batch/{batch_id}/processing-summary/`
   Shows per-task state: `IMAGE_UPLOADED`, `IMAGE_PROCESSING_STARTED`,
   `IMAGE_PROCESSING_FINISHED`, `IMAGE_PROCESSING_FAILED`.

```
process_batch_images (ARQ)
│
├─ Query assigned images for verified tasks
│
├─ For each image:
│   ├─ Copy in S3: user-uploads/ → {task_id}/images/
│   └─ Update s3_key in DB
│
└─ For each task (if ≥ 3 images):
    └─ Enqueue process_drone_images (ODM)
```

## ARQ Worker Configuration

| Setting                 | Value                       | Notes                      |
| ----------------------- | --------------------------- | -------------------------- |
| `max_jobs`              | 20                          | Concurrent ARQ jobs        |
| `job_timeout`           | 86400 s                     | 24 hours (ODM can be slow) |
| `max_tries`             | 3                           | Retries on failure         |
| `health_check_interval` | 300 s                       | 5 minutes                  |
| Queue name              | `default_queue`             |                            |
| Redis/Dragonfly         | Via `DRAGONFLY_DSN` setting |                            |

### Registered ARQ Functions

- `process_uploaded_image` — Phase 2 (ingest)
- `classify_image_batch` — Phase 3 (classify)
- `process_batch_images` — Phase 5 (move + ODM trigger)
- `delete_batch_images` — Batch deletion (S3 + DB cleanup)
- `process_drone_images` — ODM processing per task
- `process_all_drone_images` — ODM processing for all tasks
- `download_and_upload_dem` — DEM download (JAXA)

## End-to-End Flow Diagram

```
 User (Browser)                 Backend API              ARQ Worker            S3 / MinIO
 ──────────────                 ───────────              ──────────            ──────────
       │                             │                       │                     │
       │  1. Initiate upload         │                       │                     │
       │────────────────────────────▶│  create_multipart     │                     │
       │                             │────────────────────────────────────────────▶│
       │     { upload_id }           │◀────────────────────────────────────────────│
       │◀────────────────────────────│                       │                     │
       │                             │                       │                     │
       │  2. Sign part (×N chunks)   │                       │                     │
       │────────────────────────────▶│  presign_url          │                     │
       │     { presigned_url }       │                       │                     │
       │◀────────────────────────────│                       │                     │
       │  PUT chunk to presigned URL ─────────────────────────────────────────────▶│
       │◀─────────────────────────── { ETag } ────────────────────────────────────│
       │                             │                       │                     │
       │  3. Complete upload         │                       │                     │
       │────────────────────────────▶│  complete_multipart   │                     │
       │                             │──────────────────────────────────────────────▶│
       │                             │                       │                     │
       │                             │  enqueue job ────────▶│                     │
       │     { job_id }              │                       │                     │
       │◀────────────────────────────│                       │                     │
       │                             │                       │                     │
       │                             │              4. process_uploaded_image      │
       │                             │                       │  download ─────────▶│
       │                             │                       │◀────────────────────│
       │                             │                       │  hash + EXIF        │
       │                             │                       │  dedup check        │
       │                             │                       │  thumbnail ─────────▶│
       │                             │                       │  INSERT project_images
       │                             │                       │                     │
       │  (repeat 1-4 for all images)│                       │                     │
       │                             │                       │                     │
       │  5. Trigger classification  │                       │                     │
       │────────────────────────────▶│  enqueue job ────────▶│                     │
       │     { job_id }              │                       │                     │
       │◀────────────────────────────│                       │                     │
       │                             │              6. classify_image_batch        │
       │                             │                       │  quality checks     │
       │                             │                       │  GPS → task match   │
       │                             │                       │  flight tail removal│
       │                             │                       │  UPDATE statuses    │
       │                             │                       │                     │
       │  7. Poll status / review    │                       │                     │
       │────────────────────────────▶│  query project_images │                     │
       │     { status counts }       │                       │                     │
       │◀────────────────────────────│                       │                     │
       │                             │                       │                     │
       │  8. Accept/reject/verify    │                       │                     │
       │────────────────────────────▶│  UPDATE task_events   │                     │
       │◀────────────────────────────│                       │                     │
       │                             │                       │                     │
       │  9. Trigger processing      │                       │                     │
       │────────────────────────────▶│  enqueue job ────────▶│                     │
       │                             │              10. process_batch_images       │
       │                             │                       │  move files ────────▶│
       │                             │                       │  UPDATE s3_keys     │
       │                             │                       │  enqueue ODM jobs   │
       │                             │                       │                     │
```
