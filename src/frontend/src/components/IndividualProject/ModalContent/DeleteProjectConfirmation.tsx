import Input from "@Components/common/FormUI/Input";
import { Button } from "@Components/RadixComponents/Button";
import { useState } from "react";
import { m } from "@/paraglide/messages";

interface IDeleteProjectProps {
  isLoading: boolean;
  projectName: string;
  handleDeleteProject: () => void;
  setShowUnlockDialog: React.Dispatch<React.SetStateAction<boolean>>;
}

const DeleteProjectPromptDialog = ({
  isLoading,
  projectName,
  handleDeleteProject,
  setShowUnlockDialog,
}: IDeleteProjectProps) => {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const deleteProject = () => {
    if (projectName?.trim()?.toLowerCase() === value.trim()?.toLocaleLowerCase()) {
      handleDeleteProject();
      setShowUnlockDialog(false);
    } else {
      setError(m.individual_project_invalid_project_name());
    }
  };

  return (
    <div className="naxatw-flex naxatw-flex-col">
      <div className="naxatw-pb-2 naxatw-text-lg">
        {m.individual_project_delete_project_name_prompt()}
      </div>
      <Input
        value={value}
        placeholder={m.individual_project_project_name_placeholder()}
        onChange={(e) => {
          setError("");
          setValue(e.target.value);
        }}
      />
      <span className="naxatw-py-1 naxatw-text-sm naxatw-text-red">{error}</span>
      <div className="naxatw-flex naxatw-justify-end naxatw-gap-3 naxatw-py-3">
        <Button className="!naxatw-text-red" onClick={() => setShowUnlockDialog(false)}>
          {m.common_cancel()}
        </Button>
        <Button
          withLoader
          className="naxatw-bg-red"
          isLoading={isLoading}
          onClick={() => {
            deleteProject();
          }}
        >
          {m.common_delete()}
        </Button>
      </div>
    </div>
  );
};

export default DeleteProjectPromptDialog;
