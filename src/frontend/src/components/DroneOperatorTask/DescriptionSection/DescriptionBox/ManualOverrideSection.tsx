import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";

import { useGetProjectsDetailQuery, useGetUserDetailsQuery } from "@Api/projects";
import { Button } from "@Components/RadixComponents/Button";
import Modal from "@Components/common/Modal";
import Select from "@Components/common/FormUI/Select";
import { manualOverrideTaskState } from "@Services/project";
import getTaskStateLabel from "@Utils/taskStateLabel";
import { m } from "@/paraglide/messages";

// Mirror of backend `State` enum (src/backend/app/models/enums.py). Kept as
// a plain string list so this failsafe control surfaces every state the
// admin might need to force a stuck task into.
const TASK_STATES = [
  "UNLOCKED",
  "AWAITING_APPROVAL",
  "LOCKED",
  "FULLY_FLOWN",
  "HAS_IMAGERY",
  "READY_FOR_PROCESSING",
  "HAS_ISSUES",
  "IMAGE_PROCESSING_STARTED",
  "IMAGE_PROCESSING_FAILED",
  "IMAGE_PROCESSING_FINISHED",
] as const;

interface IManualOverrideSectionProps {
  projectSlug: string;
  projectId: string;
  taskId: string;
  currentState?: string;
}

const ManualOverrideSection = ({
  projectSlug,
  projectId,
  taskId,
  currentState,
}: IManualOverrideSectionProps) => {
  const queryClient = useQueryClient();
  const { data: projectData }: any = useGetProjectsDetailQuery(projectSlug);
  const { data: userDetails }: any = useGetUserDetailsQuery();

  const isAuthor =
    !!projectData?.author_id && !!userDetails?.id && projectData.author_id === userDetails.id;

  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const stateOptions = useMemo(
    () =>
      TASK_STATES.filter((s) => s !== currentState).map((s) => ({
        label: getTaskStateLabel(s),
        value: s,
      })),
    [currentState],
  );

  const { mutate: applyOverride, isPending } = useMutation({
    mutationFn: manualOverrideTaskState,
    onSuccess: () => {
      toast.success(m.drone_task_manual_override_success());
      queryClient.invalidateQueries({ queryKey: ["task-assets-info"] });
      queryClient.invalidateQueries({ queryKey: ["project-task-states"] });
      queryClient.invalidateQueries({ queryKey: ["individual-task"] });
      setSelectedState(null);
      setShowConfirm(false);
    },
    onError: (err: any) => {
      toast.error(
        err?.response?.data?.detail || err?.message || m.drone_task_manual_override_error(),
      );
    },
  });

  if (!isAuthor || !projectId || !taskId) return null;

  const handleConfirm = () => {
    if (!selectedState) return;
    applyOverride({ projectId, taskId, state: selectedState });
  };

  return (
    <>
      <div className="naxatw-mt-4 naxatw-rounded-lg naxatw-border naxatw-border-amber-200 naxatw-bg-amber-50 naxatw-p-4">
        <div className="naxatw-flex naxatw-items-start naxatw-gap-3">
          <span className="material-icons naxatw-text-[1.25rem] naxatw-text-amber-600">shield</span>
          <div className="naxatw-flex-1">
            <p className="naxatw-text-sm naxatw-font-semibold naxatw-text-amber-900">
              {m.drone_task_manual_override_title()}
            </p>
            <p className="naxatw-mt-1 naxatw-text-sm naxatw-text-amber-800">
              {m.drone_task_manual_override_description()}
            </p>
            <div className="naxatw-mt-3 naxatw-flex naxatw-flex-col naxatw-gap-2">
              <Select
                options={stateOptions}
                selectedOption={selectedState}
                placeholder={m.drone_task_manual_override_select_placeholder()}
                onChange={(value: string) => setSelectedState(value)}
              />
              <Button
                variant="outline"
                className="naxatw-w-full naxatw-border-amber-300 naxatw-bg-white naxatw-text-amber-900 hover:naxatw-bg-amber-100 disabled:naxatw-cursor-not-allowed disabled:naxatw-opacity-60"
                onClick={() => setShowConfirm(true)}
                disabled={!selectedState || isPending}
              >
                {isPending
                  ? m.drone_task_manual_override_applying()
                  : m.drone_task_manual_override_apply()}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        show={showConfirm}
        title={m.drone_task_manual_override_modal_title()}
        onClose={() => setShowConfirm(false)}
        zIndex={111111}
      >
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
          <p className="naxatw-text-sm naxatw-text-[#212121]">
            {m.drone_task_manual_override_confirm_body({
              state: selectedState ? getTaskStateLabel(selectedState) : "",
            })}
          </p>
          <p className="naxatw-text-sm naxatw-font-semibold naxatw-text-red">
            {m.drone_task_manual_override_last_resort()}
          </p>
          <div className="naxatw-flex naxatw-justify-end naxatw-gap-3 naxatw-pt-2">
            <Button onClick={() => setShowConfirm(false)} disabled={isPending}>
              {m.common_cancel()}
            </Button>
            <Button
              className="naxatw-bg-red naxatw-text-white disabled:naxatw-cursor-not-allowed disabled:naxatw-opacity-60"
              onClick={handleConfirm}
              disabled={isPending}
            >
              {isPending
                ? m.drone_task_manual_override_applying_short()
                : m.drone_task_manual_override_confirm()}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default ManualOverrideSection;
