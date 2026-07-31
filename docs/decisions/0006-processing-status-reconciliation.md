# Reconciling processing status from ScaleODM to DroneTM

## Context and Problem Statement

Users start drone image processing from the DroneTM UI. The work runs in
ScaleODM (Kubernetes-native, NodeODM-compatible, backed by Argo Workflows,
S3-native). Two things break the experience:

1. When imagery is bad (too few images, poor overlap, images that do not align),
   ScaleODM fails the job but DroneTM never learns it failed, or why. The user
   gets no signal to re-capture.
2. Status often never updates, so the spinner can spin forever.

Both have the same cause. DroneTM's only signal was whether the output
orthophoto had shown up in S3, which only detects success. A failed job writes
no output, so the task stays "processing" forever. Reconciling also only ran
when the browser asked, so even success waited for a manual refresh.

Constraints:

- No browser polling; it slows the page down.
- Status should update on page open, and the refresh button should work.
- Any background job must be bounded; it cannot scan every job ever created.
- We have no API keys to authenticate an inbound webhook.
- Either system may change on its own.

## Considered Options

1. **Browser polling.** Simple, but breaks the no-polling rule, hammers heavy
   endpoints, and gets worse with more viewers.
2. **Webhook as source of truth.** Instant, but a dropped call leaves status
   wrong forever, and it needs authentication we do not have.
3. **Unbounded reconciler.** Self-healing, but scanning all history is too
   expensive.
4. **S3 output only (the old behaviour).** Cheap, but blind to failure, which is
   the real problem, and only runs on a manual browser call.
5. **Hybrid: one reconcile routine, several triggers.** More moving parts, but no
   single point of failure, bounded cost, no polling, and it can finally reach a
   failed state.

## Decision Outcome

We chose the hybrid (option 5).

No trigger is reliable alone: webhooks get dropped, page-open only fires while
someone is watching, and a plain cron either scans too much or lags. Using all
three together covers the gaps.

### What we implemented

One routine, `reconcile_project_processing`, decides the truth. Anything that
wants status re-checked just calls it. It looks at the cheapest source first:
if the output orthophoto is in S3 (and newer than the current run, so a rerun
is not mistaken for old output) the job succeeded, no ScaleODM call needed;
otherwise it asks ScaleODM `/task/info` whether the job failed or is still
running. If ScaleODM is unreachable, it waits rather than assume failure. It is
safe to run any number of times, so callers never coordinate.

Three tiers call that routine, each catching what the one before it misses:

1. **Webhook (fast):** ScaleODM pings us when a job finishes and we re-check
   that project. We ignore the status it sends, so a missing, late, or fake
   webhook only wastes a re-check, never sets a wrong status. That is why it
   needs no real auth (an optional shared token exists, but nothing depends on
   it).
2. **Page open and refresh button (on demand):** the server reconciles that
   project when a user looks at it. Update-on-open with one call, no polling.
3. **Cron (backstop):** every 30 minutes it re-checks jobs still running, for
   when nobody is looking and the webhook was missed. It stays bounded by only
   touching jobs with a stored ScaleODM task id (`odm_task_uuid`, set when a job
   starts and cleared when it ends), not all history. If ScaleODM stops
   reporting a job, we fail it after a grace window (currently 7 days), so the
   set always empties out.

## Consequences

Good:

- Failed jobs now reach a final state, so the spinner stops and the reason shows.
- No browser polling. The page updates on open and on refresh, work done
  server-side.
- No single point of failure. The webhook is fast; the cron and page-open catch
  what it misses.
- Background cost stays limited to jobs actually running.

Costs:

- More moving parts, kept sane by routing every trigger through one routine.
- The webhook is best-effort and unauthenticated by default. Fine, because it
  only triggers a re-check and does nothing privileged; network isolation is the
  real control.
- One ScaleODM call per in-flight task when S3 has no output yet. Small in
  practice, since only unfinished jobs get that far.
