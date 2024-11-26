import { ReactNode } from 'react';

interface IBindContentContainer {
  children: ReactNode;
  className?: string;
}

const BindContentContainer = ({
  children,
  className,
}: IBindContentContainer) => {
  return (
    <div className={`naxatw-px-3 naxatw-py-8 lg:naxatw-px-20 ${className}`}>
      {children}
    </div>
  );
};

export default BindContentContainer;
