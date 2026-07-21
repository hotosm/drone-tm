# Reconciling processing status from ScaleODM to DroneTM

## Context and Problem Statement

Users trigger drone image processing from the DroneTM UI. The work runs in
ScaleODM (Kubernetes-native, NodeODM-compatible, backed by Argo Workflows,
S3-native). Two problems hurt the experience:

1. When imagery is bad (too few images, poor overlap, images that do not
   align), ScaleODM fails the job but DroneTM never learns why, or even that it
   failed. The user gets no signal to fix or re-capture.
2. The processing status often never updates, and the spinner can spin forever.

Both share one cause. DroneTM's only signal is whether the output orthophoto
has appeared in S3, which detects success only. When a job fails, no output is
written, so the task stays "processing" forever and the UI spins. Reconciling
also only happens when the browser asks, so even success is delayed until a
manual refresh.

Constraints:

- No browser polling; it hurts page performance.
- Status should update when the page opens, and a refresh button should update
  it correctly.
- Any background job must be bounded; it cannot scan every processing job ever
  created.
- DroneTM has no API-key infrastructure to authenticate an inbound webhook.
- Either system may change.

## Considered Options

### 1. Browser polling

The page polls for status on a timer.

- Pro: simple.
- Con: violates the no-polling constraint, hammers heavy endpoints, and cost
  grows with the number of viewers.

### 2. Webhook as the source of truth

ScaleODM pushes status and DroneTM trusts and stores it.

- Pro: instant, no polling.
- Con: delivery is never guaranteed, so a dropped call leaves status wrong
  forever. Needs authentication we do not have.

### 3. Unbounded reconciler

A job periodically reconciles all processing tasks.

- Pro: self-healing, no reliance on delivery.
- Con: does not scale; scanning all history is too expensive.

### 4. S3 output only (the current behaviour)

- Pro: cheap, needs no ScaleODM credentials.
- Con: blind to failure, which is the real problem, and only runs on a manual
  browser call.

### 5. Push trigger, read-repair, and a bounded backstop (chosen)

One reconcile routine, called by several triggers, that checks the cheapest
source first and only asks ScaleODM when it must.

- Pro: no single point of failure, bounded cost, no polling, and it can finally
  reach a failed state.
- Con: more moving parts, so it needs a rule to stay bounded.

## Decision Outcome

Chosen: option 5.

The key idea is that the webhook is a trigger, not a source of truth. It only
means "re-check this task now". The real status is always derived by the
reconcile routine, so a missing, late, or spoofed webhook can only cause a cheap
re-check, never wrong status. This is also why the webhook needs no real
authentication.

One reconcile routine derives status cheapest-first:

1. If the output orthophoto is in S3, the task succeeded. This needs no ScaleODM
   call.
2. Otherwise ask ScaleODM for the task status, purely to tell "failed" from
   "still running". A terminal failure moves the task to failed and records the
   reason.

The routine is idempotent, so every trigger can call it safely:

- Webhook: ScaleODM notifies DroneTM on terminal transitions only, and DroneTM
  re-checks that one task. This is the fast path.
- Page open and manual refresh: the server reconciles that project, giving
  update-on-open with a single call and no polling.
- Cron: a low-frequency backstop that reconciles only work still in flight.

Bounding the cron: a task is "in flight" only while it has a stored ScaleODM
task id, which is set on submit and cleared on any terminal transition. The
cron therefore only looks at jobs processing right now, limited by cluster
capacity rather than history. A job ScaleODM can no longer find is failed after
a grace window, so the set always drains.

Why the cron exists at all: page-open only reconciles while someone is
watching, and webhooks can be dropped. The cron guarantees status still reaches
the truth when nobody is looking, turning the system from best-effort into
failsafe. It is optional if we accept that status is only correct while a user
views the page.

### Consequences

Positive:

- ✅ A failed job now reaches a terminal state, so the spinner stops and the
  reason is shown.
- ✅ No browser polling. The page updates on open and on manual refresh, with the
  heavy work done server-side.
- ✅ No single point of failure. The webhook is the fast path; the cron and
  page-open reconcile heal anything it misses.
- ✅ The background cost is bounded to jobs that are actually processing.

Negative:

- ❌ More moving parts than a single mechanism, kept manageable by routing every
  trigger through one idempotent routine.
- ❌ The webhook is best-effort and unauthenticated by default. Acceptable because
  it only triggers a re-check and carries no privileged action; network
  isolation is the real control.
- ❌ Reconcile makes one ScaleODM call per in-flight task when S3 has no output
  yet. Small in practice, since only genuinely unfinished tasks reach that step.
