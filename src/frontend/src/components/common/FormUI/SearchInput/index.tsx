import { ChangeEventHandler } from 'react';
import Icon from '@Components/common/Icon';
import { FlexRow } from '@Components/common/Layouts';
import Input from '../Input';

interface ISearchInputProps {
  inputValue: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  onClear?: () => void;
  showClearIcon?: boolean;
  className?: string;
}

export default function SearchInput({
  inputValue,
  placeholder,
  onChange,
  onClear,
  showClearIcon = false,
  className,
}: ISearchInputProps) {
  return (
    <FlexRow
      className={`hover:naxatw-border-b-primary-400 naxatw-group naxatw-relative naxatw-w-full naxatw-items-center naxatw-border-b-2 ${className}`}
    >
      <Icon
        name="search"
        className="group-hover:naxatw-text-primary-400 naxatw-text-grey-500"
      />
      <Input
        type="text"
        className="naxatw-w-full naxatw-border-none"
        placeholder={placeholder || 'Search'}
        value={inputValue}
        onChange={onChange}
      />
      {(!!inputValue.length || showClearIcon) && (
        <Icon
          name="clear"
          onClick={onClear}
          className="naxatw-rounded-full naxatw-px-1 !naxatw-text-xs naxatw-text-gray-800 hover:naxatw-bg-redlight"
        />
      )}
    </FlexRow>
  );
}
