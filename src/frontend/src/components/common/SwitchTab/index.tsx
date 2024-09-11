/* eslint-disable no-unused-vars */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { cn } from '@Utils/index';
import { FlexRow } from '@Components/common/Layouts';

interface ISwitchTabProps {
  wrapperClassName?: string;
  options: Record<string, any>[];
  selectedValue: string | number;
  onChange: any;
  valueKey?: string;
  labelKey?: string;
  activeClassName?: string;
}
const SwitchTab = ({
  wrapperClassName,
  options,
  selectedValue,
  onChange,
  valueKey = 'id',
  labelKey = 'label',
  activeClassName,
}: ISwitchTabProps) => {
  return (
    <FlexRow
      className={cn(
        'naxatw-w-fit naxatw-items-center naxatw-rounded-lg naxatw-bg-[#F4F7FE] naxatw-p-1',
        wrapperClassName,
      )}
    >
      {options?.map((option: Record<string, any>) => (
        <span
          role="button"
          tabIndex={0}
          key={option[labelKey]}
          className={`naxatw-body-sm naxatw-cursor-pointer naxatw-select-none naxatw-rounded-lg naxatw-px-[0.5rem] naxatw-py-[0.4rem] naxatw-capitalize${
            option[valueKey] === selectedValue
              ? cn(
                  `naxatw-bg-red naxatw-text-white naxatw-shadow-[0px_0px_5px_0px_rgba(0,0,0,0.16)]`,
                  activeClassName,
                )
              : 'naxatw-text-matt-200 hover:naxatw-text-primary-700'
          } naxatw-duration-300`}
          onClick={() => {
            onChange(option);
          }}
        >
          {option[labelKey]}
        </span>
      ))}
    </FlexRow>
  );
};
export default SwitchTab;
