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
      className={`naxatw-group naxatw-relative naxatw-w-full naxatw-items-center 
        naxatw-border-b-2 hover:naxatw-border-b-primary-400 ${className}`}
    >
      <Icon
        name="search"
        className="naxatw-text-grey-500 group-hover:naxatw-text-primary-400"
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
          className="hover:naxatw-text-primary-400"
        />
      )}
    </FlexRow>
  );
}
