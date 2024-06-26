import { ReactElement } from 'react';
import Icon from '@Components/common/Icon';
import capitalizeFirstLetter from '@Utils/capitalizeFirstLetter';

interface IChipProps {
  label: string | ReactElement;
  onClose: any;
}

export default function Chip({ label, onClose }: IChipProps) {
  return (
    <div
      className="naxatw-flex naxatw-h-8 naxatw-cursor-pointer naxatw-items-center naxatw-gap-1
      naxatw-rounded-lg naxatw-border naxatw-border-grey-300 naxatw-bg-grey-100 naxatw-px-2 naxatw-text-sm"
    >
      <p>{capitalizeFirstLetter(label.toString())}</p>
      <Icon
        onClick={onClose}
        name="close"
        className="!naxatw-text-icon-sm naxatw-font-bold "
      />
    </div>
  );
}
