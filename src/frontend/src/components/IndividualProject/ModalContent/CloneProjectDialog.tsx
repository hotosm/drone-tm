import { useState } from "react";
import Input from "@Components/common/FormUI/Input";
import { Button } from "@Components/RadixComponents/Button";
import { m } from "@/paraglide/messages";

interface ICloneProjectDialogProps {
  currentProjectName: string;
  onClose: () => void;
  // eslint-disable-next-line no-unused-vars
  onClone: (newName: string) => void;
  isLoading?: boolean;
}

const CloneProjectDialog = ({
  currentProjectName,
  isLoading,
  onClose,
  onClone,
}: ICloneProjectDialogProps) => {
  const [projectName, setProjectName] = useState(
    currentProjectName ? `${currentProjectName} (Clone)` : ""
  );
  const [error, setError] = useState("");

  const handleConfirm = () => {
    if (!projectName.trim()) {
      setError(m.individual_project_clone_dialog_empty_error());
      return;
    }
    onClone(projectName.trim());
  };

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-3 naxatw-p-2">
      <div className="naxatw-text-sm naxatw-text-gray-600">
        {m.individual_project_clone_dialog_description()}
      </div>

      <div>
        <label className="naxatw-block naxatw-text-xs naxatw-font-semibold naxatw-text-gray-700 naxatw-mb-1">
          {m.individual_project_clone_dialog_name_label()}
        </label>
        <Input
          value={projectName}
          placeholder={m.individual_project_clone_dialog_placeholder()}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setError("");
            setProjectName(e.target.value);
          }}
        />
        {error && (
          <span className="naxatw-text-xs naxatw-text-red naxatw-mt-1 naxatw-block">
            {error}
          </span>
        )}
      </div>

      <div className="naxatw-flex naxatw-justify-end naxatw-gap-2 naxatw-pt-3">
        <Button
          variant="ghost"
          className="naxatw-text-gray-600"
          onClick={onClose}
        >
          {m.common_cancel()}
        </Button>
        <Button
          withLoader
          isLoading={isLoading}
          className="naxatw-bg-[#D73F3F] naxatw-text-white"
          onClick={handleConfirm}
        >
          {m.individual_project_clone_dialog_button_submit()}
        </Button>
      </div>
    </div>
  );
};

export default CloneProjectDialog;
