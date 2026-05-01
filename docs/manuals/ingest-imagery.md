# Creating A Project Based On Existing Imagery

!!! note

    Currently this workflow is only available to DroneTM admins.

    In future, it may be made public.

Sometimes the data collection flow is backwards:

1. Instead of creating a project first, then flying for imagery,
   the data may have been captured through other means.
2. In this scenario, you may wish to retroactively create a
   DroneTM project to handle the images, pre-process,
   and do the final processing.
3. Doing this requires a slightly different workflow
   (normally hidden to most users).

## 1. Create a project from S3 images

1. Visit https://drone.hotosm.org/import
2. Enter a project name.
3. Point to your public S3 bucket, including a data
   path.
4. All JPEG images under this path (and in subpaths)
   will be scanned, and a project created that bounds
   the imagery locations completely.

## 2. Upload the imagery

1. Now a project exists, you can upload to the `user-uploads`
   directory of the specific project.
2. Transfer data using a tool like RClone to
   `dtm-data/projects/<project_id>/user-uploads`.

## 3. Ingest the imagery

1. Once the data is present in the DroneTM S3 bucket we can
   'ingest' it. This means the imagery is scanned and database
   entries are made.
2. Go to the project details page.
3. Click the Upload Imagery button.
4. Hold CTRL and see the Ingest Imagery button.
5. Click the button.

## 4. Continue as normal

- Once the imagery is ingested into the database,
  you can continue DroneTM workflows as normal.
- The next step would be to Classify the imagery,
  i.e. divide it into task areas and pre-process
  flag photos with issues.
