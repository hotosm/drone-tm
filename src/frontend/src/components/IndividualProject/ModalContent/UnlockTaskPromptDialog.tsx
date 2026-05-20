import { Button } from "@Components/RadixComponents/Button";
import { m } from "@/paraglide/messages";

interface IUnlockTaskPromptDialogProps {
  handleUnlockTask: () => void;
  setShowUnlockDialog: React.Dispatch<React.SetStateAction<boolean>>;
}

const UnlockTaskPromptDialog = ({
  handleUnlockTask,
  setShowUnlockDialog,
}: IUnlockTaskPromptDialogProps) => {
  return (
    <div className="naxatw-flex naxatw-flex-col">
      <div className="naxatw-text-lg">{m.individual_project_unlock_task_confirm()}</div>
      <div className="naxatw-flex naxatw-justify-end naxatw-gap-3 naxatw-py-3">
        <Button className="!naxatw-text-red" onClick={() => setShowUnlockDialog(false)}>
          {m.common_cancel()}
        </Button>
        <Button
          className="naxatw-bg-red"
          onClick={() => {
            handleUnlockTask();
            setShowUnlockDialog(false);
          }}
        >
          {m.individual_project_unlock()}
        </Button>
      </div>
    </div>
  );
};

export default UnlockTaskPromptDialog;
