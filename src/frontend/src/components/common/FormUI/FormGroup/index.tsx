import { ReactNode } from 'react';

interface IFormGroupProps {
  children: ReactNode;
}

export default function FormGroup({ children }: IFormGroupProps) {
  return <div>{children}</div>;
}
