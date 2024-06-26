import { ReactNode } from 'react';
import { FlexColumn } from '@Components/common/Layouts';

interface IFormControlProps {
  children: ReactNode;
  className?: string;
}

export default function FormControl({
  children,
  className,
}: IFormControlProps) {
  return <FlexColumn className={className}>{children}</FlexColumn>;
}
