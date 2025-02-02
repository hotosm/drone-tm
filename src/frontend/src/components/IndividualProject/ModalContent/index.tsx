import Modal from '@Components/common/Modal';
import { MouseEventHandler, ReactNode } from 'react';

interface IPromptDialogProps {
  title: string;
  show: boolean;
  onClose: MouseEventHandler;
  children: ReactNode;
}

export function ProjectPromptDialog({
  title = '',
  show = false,
  onClose = () => {},
  children,
}: IPromptDialogProps) {
  return (
    <Modal show={show} title={title} onClose={onClose} zIndex={111111}>
      {children}
    </Modal>
  );
}

export default ProjectPromptDialog;
