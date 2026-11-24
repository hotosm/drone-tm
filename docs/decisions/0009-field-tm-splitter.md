# Team assignment using the Field-TM task planner

Builds on [0008](./0008-browser-dem-sampling.md). The feature itself is
described in Field-TM's
[0008](https://github.com/hotosm/field-tm/blob/dev/docs/decisions/0008-planner-team-split.md).

## Context and Problem Statement

Operators need to divide tasks fairly between field teams (so the hills are
shared), and print a map of who goes where.

The method was co-developed with the Sierra Leone field and drone mapping
team. The Field-TM task planner already does most of this, and also runs
standalone or inside Field-TM (selected by URL parameters). Its source lives in
[`field-tm/src/planner`](https://github.com/hotosm/field-tm/tree/dev/src/planner).

## Considered Options

- Build team assignment into Drone-TM
- Link out to the hosted planner on `field.hotosm.org`
- Bundle the planner into Drone-TM (chosen)

## Decision Outcome

We bundle a pinned `ghcr.io/hotosm/field-tm-planner` image into the frontend
at `/splitter`, the same way as `/mesh` and `/plan`. Self-hosted Drone-TM
then has no dependency on a Field-TM deployment.

**How it works**:

1. "Assign teams" on the project page opens
   `/splitter/?dronetm=<api>/projects/<id>`.
2. The planner reads the public project endpoint (no login), and shows the
   existing tasks and no-fly zones.
3. The operator enters the number of teams, clicks divide, and prints.

The squares are fixed. Splitting, merging and drawing are disabled, and
nothing goes back to Drone-TM. This keeps the printout in sync with
Drone-TM's task numbers. Teams aren't recorded in DroneTM, but instead
only on the frontend.

Terrain uses the same GLO-30 service we already depend on
(`OAM_RASTER_API_URL`), so no new dependency.

**Local dev**: `/splitter` serves the planner from the image. To work on it,
run `just build planner` in Field-TM, and set `SPLITTER_DIST_DIR` to its
`src/planner/dist`.

### Consequences

- ✅ Fair team split and printout, with no backend changes.
- ✅ Works the same on self-hosted deployments.
- ✅ Reuses work already in FieldTM, without re-implementation.
- ❌ Planner fixes only arrive when we bump the pinned image.
- ❌ Task shapes can only be changed in Drone-TM, at project creation.
