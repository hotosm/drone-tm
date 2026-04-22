# A guide for creating a project in Drone Tasking Manager

All credit for this guide goes to Bertha Phiri @ CCode Malawi 🙌

## 1. Open the drone tasking manager <https://drone.hotosm.org/>

- Click on dashboard
- Click 'I am a project creator'
- Click on projects
- Click on 'Add Project'

## 2. Basic information

- Fill in the name of your project
- Fill in the description of the project

> HIT NEXT

## 3. Define the area of interest (AOI)

- Turn on the icon that looks like a circle on the map so that it gives/shows your
  location on the map
- Two ways to define your AOI
  1. Using the icon that looks like a pencil, draw or demarcate the boundary
     where you want to do the mapping.
  2. Upload the GeoJSON file of the area where you want to map. (You
     can easily convert your boundary shapefile to a GeoJSON file in QGIS).

> HIT NEXT

## 4. Key parameters

1. Ground spacing distance (cm/pixel)
   - 4cm
2. Merge Type
   - Front Overlap put 75%
   - Side Overlap put 75%
3. Final Output
   - Select 2D orthophoto (I am not sure about the)

> HIT NEXT

## 5. Generate Task

- Dimension of square (m)
  1. 400m is a good default here.
  2. Click 'Generate Tasks'

## 6. Instructions for the Drone pilot

- Provide instructions for the pilots to follow all
  required rules while in the field.

## 7. Does this project require approval from the local committee?

- Generally not required.
- If you have stricter flight permission / regulation requirements,
  in your city, you may need approval from the aviation authority
  or city council first.

!!! IMPORTANT

    Please make sure you have the relevant permission to fly
    in your area, before creating a project!

## 8. Approval for task lock

- Generally not required.
- If strict control is required for who can map where,
  by a manager, then enable this.

## Lastly

- Hit the 'Create' button.
