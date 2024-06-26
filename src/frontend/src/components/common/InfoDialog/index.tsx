import Icon from '@Components/common/Icon';
import React from 'react';

type InfoDialogProps = {
  status?: string;
  children?: React.ReactNode;
};

const getStatus = (status: string | undefined) => {
  switch (status) {
    case 'info':
      return { icon: 'info', bgColor: 'naxatw-bg-primary-400' };
    case 'success':
      return { icon: 'check_circle', bgColor: 'naxatw-bg-green-700' };
    case 'error':
      return { icon: 'cancel', bgColor: 'naxatw-bg-red-600' };
    default:
      return { icon: 'info', bgColor: 'naxatw-bg-primary-400' };
  }
};

const InfoDialog: React.FC<InfoDialogProps> = ({ status, children }) => {
  const infoStatus = getStatus(status);

  return (
    <div
      className={`${infoStatus.bgColor} naxatw-mb-10 naxatw-flex naxatw-w-full naxatw-items-center
      naxatw-gap-2 naxatw-rounded-md naxatw-p-3 naxatw-opacity-40`}
    >
      <Icon name={infoStatus.icon} className="naxatw-text-grey-200" />
      <span className="naxatw-text-base naxatw-text-grey-200">{children}</span>
    </div>
  );
};

export default InfoDialog;
