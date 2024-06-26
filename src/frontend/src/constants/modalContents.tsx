import { ReactElement } from 'react';

export type ModalContentsType = 'sign-up-success' | null;
export type PromptDialogContentsType = 'delete-layer' | null;

type ModalReturnType = {
  title: string;
  content: ReactElement;
  className?: string;
  hideCloseButton?: boolean;
};

export function getModalContent(content: ModalContentsType): ModalReturnType {
  switch (content) {
    case 'sign-up-success':
      return {
        title: '',
        content: <></>,
      };
    default:
      return {
        title: '',
        content: <></>,
      };
  }
}

export function getPromptDialogContent(
  content: PromptDialogContentsType,
): ModalReturnType {
  switch (content) {
    case 'delete-layer':
      return {
        title: '',
        content: <></>,
      };
    default:
      return {
        title: '',
        content: <></>,
      };
  }
}
