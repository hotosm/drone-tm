import Input from '@Components/common/FormUI/Input';
import { Button } from '@Components/RadixComponents/Button';
import { useState } from 'react';

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
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const deleteProject = () => {
    if (
      projectName?.trim()?.toLowerCase() === value.trim()?.toLocaleLowerCase()
    ) {
      handleDeleteProject();
      setShowUnlockDialog(false);
    } else {
      setError('Invalid Project Name');
    }
  };

  return (
    <div className="naxatw-flex naxatw-flex-col">
      <div className="naxatw-pb-2 naxatw-text-lg">
        Enter Project Name to Delete the Project
      </div>
      <Input
        value={value}
        placeholder="Enter Project Name"
        onChange={e => {
          setError('');
          setValue(e.target.value);
        }}
      />
      <span className="naxatw-py-1 naxatw-text-sm naxatw-text-red">
        {error}
      </span>
      <div className="naxatw-flex naxatw-justify-end naxatw-gap-3 naxatw-py-3">
        <Button
          className="!naxatw-text-red"
          onClick={() => setShowUnlockDialog(false)}
        >
          Cancel
        </Button>
        <Button
          withLoader
          className="naxatw-bg-red"
          isLoading={isLoading}
          onClick={() => {
            deleteProject();
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
};

export default DeleteProjectPromptDialog;
