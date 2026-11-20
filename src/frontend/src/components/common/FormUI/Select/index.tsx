/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable no-unused-vars */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
import { useEffect, useRef, useState } from "react";
import Icon from "@Components/common/Icon";
import { m } from "@/paraglide/messages";
import Input from "../Input";

interface ISelectProps {
  options: Record<string, any>[];
  selectedOption?: string | number | null;
  placeholder?: string;
  onChange?: (selectedOption: any) => void;
  labelKey?: string;
  valueKey?: string;
  direction?: string;
  className?: string;
  withSearch?: boolean;
  inputTagClassname?: string;
}

function getPosition(direction: string) {
  switch (direction) {
    case "top":
      return "naxatw-bottom-[2.4rem]";
    case "bottom":
      return "naxatw-top-[2.8rem]";
    default:
      return "naxatw-top-[3rem]";
  }
}

export default function Select({
  options,
  selectedOption,
  onChange,
  placeholder,
  labelKey = "label",
  valueKey = "value",
  direction = "bottom",
  className,
  withSearch = false,
  inputTagClassname,
}: ISelectProps) {
  const resolvedPlaceholder = placeholder ?? m.common_select();
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState(selectedOption);
  const [position, setPosition] = useState(direction);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [searchText, setSearchText] = useState("");
  const [hasMoreBelow, setHasMoreBelow] = useState(false);

  useEffect(() => {
    setSelected(selectedOption);
  }, [selectedOption]);

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  const handleClickOutside = (event: MouseEvent) => {
    if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
      setIsOpen(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      dropdownRef?.current?.focus();
    } else {
      setSearchText("");
    }
  }, [isOpen]);

  useEffect(() => {
    document.addEventListener("click", handleClickOutside);

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, []);

  const handleOptionClick = (value: string) => {
    setSelected(value);
    // @ts-ignore
    onChange(value);
  };

  // check if selected option value matches with item value key
  const selectedLabel = options.find((item) => item[valueKey] === selected)?.[labelKey];

  const getPlaceholderText = () => {
    if (selected) {
      return selectedLabel || resolvedPlaceholder;
    }
    return resolvedPlaceholder;
  };

  const filterOptions = options?.filter((opt) =>
    opt[labelKey].toLowerCase().includes(searchText.toLowerCase()),
  );

  const showClearIcon = !!searchText.length;

  // the list scrolls with no visible scrollbar, so fade its bottom edge while options remain below
  const updateHasMoreBelow = () => {
    const list = listRef.current;
    setHasMoreBelow(!!list && list.scrollTop + list.clientHeight < list.scrollHeight - 1);
  };

  useEffect(() => {
    if (isOpen) updateHasMoreBelow();
  }, [isOpen, options, searchText]);

  return (
    <div className="naxatw-relative">
      <div
        ref={dropdownRef}
        className={`naxatw-group naxatw-relative naxatw-flex naxatw-h-9 naxatw-w-full naxatw-cursor-pointer naxatw-items-center naxatw-justify-between naxatw-rounded-md naxatw-border naxatw-border-gray-800 hover:naxatw-border-red ${className}`}
        onClick={toggleDropdown}
      >
        {withSearch ? (
          <Input
            type="text"
            placeholder={getPlaceholderText()}
            className={`naxatw-w-full naxatw-border-none ${inputTagClassname} ${
              selected ? "placeholder:naxatw-text-grey-800" : ""
            } focus:placeholder:naxatw-text-grey-400`}
            value={searchText}
            onClick={(e) => {
              setIsOpen(true);
            }}
            onChange={(e) => {
              setSearchText(e.target.value);
            }}
          />
        ) : (
          <p
            className={`naxatw-w-full naxatw-border-none ${
              selected && selectedLabel ? "naxatw-text-grey-800" : ""
            } naxatw-px-2 naxatw-text-sm naxatw-text-grey-400`}
          >
            {getPlaceholderText()}
          </p>
        )}

        {showClearIcon ? (
          <Icon
            name="clear"
            className="hover:naxatw-text-primary-400 naxatw-absolute naxatw-right-0 naxatw-items-center !naxatw-text-base"
            onClick={() => setSearchText("")}
          />
        ) : (
          <Icon
            name={
              // eslint-disable-next-line no-nested-ternary
              !isOpen ? "expand_more" : withSearch ? "search" : "expand_less"
            }
            className="group-hover:naxatw-text-primary-400 naxatw-absolute naxatw-right-1 naxatw-items-center"
          />
        )}
      </div>

      {isOpen && (
        <ul
          ref={listRef}
          onScroll={updateHasMoreBelow}
          className={`scrollbar naxatw-absolute naxatw-z-20 naxatw-flex naxatw-max-h-[150px] naxatw-w-full naxatw-animate-flip-down naxatw-flex-col naxatw-overflow-auto naxatw-rounded-md naxatw-border naxatw-bg-white naxatw-shadow-lg naxatw-duration-300 ${getPosition(
            position,
          )} `}
        >
          {options && filterOptions.length > 0 ? (
            filterOptions.map((option) => (
              <li
                className="hover:naxatw-bg-primary-50 naxatw-flex naxatw-cursor-pointer naxatw-list-none naxatw-items-start naxatw-px-4 naxatw-py-2.5 naxatw-text-sm naxatw-text-grey-800"
                key={option[valueKey]}
                onClick={() => handleOptionClick(option[valueKey])}
              >
                <div>{option[labelKey]}</div>
              </li>
            ))
          ) : (
            <li className="naxatw-cursor-default naxatw-px-4 naxatw-py-2.5 naxatw-text-sm">
              {m.common_no_options_available()}
            </li>
          )}
          <li
            aria-hidden="true"
            className={`naxatw-pointer-events-none naxatw-sticky naxatw-bottom-0 -naxatw-mt-10 naxatw-h-10 naxatw-shrink-0 naxatw-list-none naxatw-bg-gradient-to-t naxatw-from-white naxatw-to-transparent naxatw-transition-opacity naxatw-duration-200 motion-reduce:naxatw-transition-none ${
              hasMoreBelow ? "naxatw-opacity-100" : "naxatw-opacity-0"
            }`}
          />
        </ul>
      )}
    </div>
  );
}
