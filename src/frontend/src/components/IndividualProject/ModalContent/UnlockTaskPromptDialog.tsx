import { Button } from '@Components/RadixComponents/Button';

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
      <div className="naxatw-text-lg">
        Are you sure you want to unlock the task?
      </div>
      <div className="naxatw-flex naxatw-justify-end naxatw-gap-3 naxatw-py-3">
        <Button
          className="!naxatw-text-red"
          onClick={() => setShowUnlockDialog(false)}
        >
          Cancel
        </Button>
        <Button
          className="naxatw-bg-red"
          onClick={() => {
            handleUnlockTask();
            setShowUnlockDialog(false);
          }}
        >
          Unlock
        </Button>
      </div>
    </div>
  );
};

export default UnlockTaskPromptDialog;
