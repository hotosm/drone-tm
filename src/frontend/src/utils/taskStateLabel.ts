import { m } from "@/paraglide/messages";
import { formatString } from "./index";

const TASK_STATE_LABELS: Record<string, () => string> = {
  UNLOCKED: m.task_state_unlocked,
  AWAITING_APPROVAL: m.task_state_awaiting_approval,
  LOCKED: m.task_state_locked,
  FULLY_FLOWN: m.task_state_fully_flown,
  HAS_IMAGERY: m.task_state_has_imagery,
  READY_FOR_PROCESSING: m.task_state_ready_for_processing,
  HAS_ISSUES: m.task_state_has_issues,
  IMAGE_PROCESSING_STARTED: m.task_state_image_processing_started,
  IMAGE_PROCESSING_FAILED: m.task_state_image_processing_failed,
  IMAGE_PROCESSING_FINISHED: m.task_state_image_processing_finished,
};

const getTaskStateLabel = (state?: string | null) =>
  state ? TASK_STATE_LABELS[state]?.() || formatString(state) : "";

export default getTaskStateLabel;
