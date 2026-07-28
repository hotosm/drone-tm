// Controller-glue coverage (the mixins) via the jsdom harness. These are the
// paths that previously only had manual smoke-testing: the pending-selection
// lifecycle, the label commit flow, tool/intent chrome sync, and the review
// state machine.
import { makeApp, wholeQuad, assert } from "./harness.mjs";

// --- labeling: commit flow -------------------------------------------------
{
  const { app, mesh, labels } = makeApp();

  app.selectionCtl.applyPaint("add", wholeQuad(mesh)); // brush/lasso-style add with no prior pending
  assert(app.pending && app.pending.faceCount === 2, "applyPaint(add) starts a pending selection");
  assert(
    document.getElementById("label-panel").classList.contains("active"),
    "commit panel opens on a fresh selection"
  );

  app.labelingCtl.pickClass("building-roof");
  app.labelingCtl.pickConfidence("confirmed");
  assert(app.labelingCtl.pickedClass === "building-roof", "pickClass records the chosen class");
  app.labelingCtl.saveLabel();

  assert(labels.list.length === 1, "saveLabel persists one label");
  assert(labels.list[0].class === "building-roof", "saved label carries the picked class");
  assert(labels.list[0].confidence === "confirmed", "saved label carries the picked confidence");
  assert(app.pending === null, "pending clears after save");
  assert(
    document.getElementById("labels-count").textContent.startsWith("1 label"),
    "status card count updates"
  );
}

// --- selection lifecycle: undo + cancel ------------------------------------
{
  const { app, mesh } = makeApp();

  app.selectionCtl.applyPaint("add", wholeQuad(mesh));
  assert(app.pending.faceCount === 2, "pending has both faces");

  app.selectionCtl.pushPendingHistory();
  app.selectionCtl.applyPaint("remove", new Map([[mesh, new Set([1])]]));
  assert(app.pending.faceCount === 1, "remove drops a face");

  app.selectionCtl.undoPending();
  assert(app.pending.faceCount === 2, "undo restores the prior selection");

  app.selectionCtl.cancelPendingSelection();
  assert(app.pending === null, "cancel clears the pending selection");
  assert(
    !document.getElementById("label-panel").classList.contains("active"),
    "cancel hides the commit panel"
  );
}

// --- chrome: intent + tool sync --------------------------------------------
{
  const { app } = makeApp({ editTool: "navigate" });

  app.chrome.setIntent("remove");
  assert(app.chrome.editIntent === "remove", "setIntent updates intent");
  assert(
    document.getElementById("toolbar").classList.contains("erasing"),
    "erase modifier reflected on the tool bar"
  );

  app.chrome.setTool("brush");
  assert(app.chrome.editTool === "brush", "setTool updates the active tool");
  assert(app.controls.paintMode === true, "brush locks the camera controller into paint mode");
  assert(
    document.querySelector('[data-tool="brush"]').classList.contains("active"),
    "brush button shows active in the tool bar"
  );
}

// --- review: enter, arm, adjust, dirty-save --------------------------------
{
  const { app, mesh, labels } = makeApp();
  labels.add({
    selected: wholeQuad(mesh),
    classId: "building-roof",
    confidence: "unsure",
    suggested: "building-roof",
    targetClass: "roof-flat",
  });

  app.reviewCtl.enterReviewMode();
  assert(app.mode === "review", "enterReviewMode switches mode");
  assert(document.body.classList.contains("review-mode"), "review-mode body class set");
  assert(app.pending && app.pending.selected.size, "first queue item armed as a live pending selection");
  assert(app.reviewCtl.reviewAdjust === true, "review item is armed for editing");

  app.reviewCtl.setReviewAdjusting(true);
  assert(document.body.classList.contains("adjusting"), "Adjust reveals the editing tools (body.adjusting)");
  app.reviewCtl.setReviewAdjusting(false);
  assert(!document.body.classList.contains("adjusting"), "leaving Adjust clears body.adjusting");

  // dirty edit → Confirm saves the reclass instead of running the plain verb
  app.reviewCtl.pendingDirty = true;
  app.labelingCtl.pickClass("ground");
  const handled = app.reviewCtl.handleReviewConfirm();
  assert(handled === true, "dirty Confirm is handled as a save");
  assert(labels.list[0].class === "ground", "the reclass was saved to the label");
}

// --- labeling: click-to-edit an existing label ----------------------------
{
  const { app, mesh, labels } = makeApp();
  const label = labels.add({
    selected: wholeQuad(mesh),
    classId: "ground",
    confidence: "unsure",
    suggested: "ground",
    targetClass: "roof-flat",
  });

  app.labelingCtl.enterEditLabel(label);
  assert(app.editingLabelId === label.id, "enterEditLabel targets the tapped label");
  assert(app.pending && app.pending.faceCount === 2, "editing loads the label's faces as pending");
  assert(app.labelingCtl.pickedClass === "ground", "editing preselects the label's own class");

  app.labelingCtl.pickClass("building-roof");
  app.labelingCtl.saveLabel();
  assert(labels.list.length === 1, "editing updates in place — no duplicate label");
  assert(labels.list[0].class === "building-roof", "the edit saved the new class");
  assert(app.editingLabelId === null, "edit state clears after save");
}

// --- selection: grow snapshots undo; shrink refuses to erase everything ----
{
  const { app, mesh } = makeApp();
  app.selectionCtl.applyPaint("add", wholeQuad(mesh));

  const h0 = app.pendingHistory.length;
  app.selectionCtl.growPending();
  assert(app.pendingHistory.length === h0 + 1, "growPending snapshots history for undo");
  app.selectionCtl.undoPending();
  assert(app.pending.faceCount === 2, "undo after grow restores the selection");

  app.selectionCtl.shrinkPending();
  assert(app.pending.faceCount === 2, "shrink refuses to erode the selection to nothing");
}

// --- selection: brush seeds a selection from the surface under the cursor --
{
  const { app, mesh } = makeApp();
  app.camera.position.set(0.5, 5, 0.5);
  app.camera.lookAt(0.5, 0, 0.5); // straight down onto the fixture quad
  app.camera.updateMatrixWorld(true);
  app.chrome.editIntent = "add";

  app.selectionCtl.onBrush(400, 300, 40); // canvas centre → NDC (0,0) → ray hits the quad
  assert(app.pending && app.pending.faceCount >= 1, "brush at a surface starts a pending selection");
}

// --- labeling: view-filter wiring ------------------------------------------
{
  const { app, mesh, labels } = makeApp();
  labels.add({
    selected: wholeQuad(mesh),
    classId: "ground",
    confidence: "confirmed",
    suggested: "ground",
    targetClass: "roof-flat",
  });
  app.labelingCtl.renderLabelList();

  document.querySelector('#view-modes [data-view="all"]').click();
  assert(app.labelingCtl.viewMode === "all", "clicking a view mode updates the active view");
}

// --- review: skipping through the queue completes and disarms --------------
{
  const { app, mesh, labels } = makeApp();
  labels.add({ selected: new Map([[mesh, new Set([0])]]), classId: "ground", confidence: "unsure", suggested: "ground", targetClass: "roof-flat" });
  labels.add({ selected: new Map([[mesh, new Set([1])]]), classId: "ground", confidence: "unsure", suggested: "ground", targetClass: "roof-flat" });

  app.reviewCtl.enterReviewMode();
  assert(app.review.active, "review active with a queue");
  const total = app.review.queue.length;
  assert(total === 2, "queue holds both labels");

  app.review.skip();
  app.review.skip();
  assert(app.review.index >= total, "skipping through the queue completes it");
  assert(app.reviewCtl.reviewAdjust === false, "completion disarms editing");
  assert(
    document.getElementById("ra-adjust").style.display === "none",
    "Adjust button is hidden at completion"
  );
}

console.log("\nAll controller tests passed.");
