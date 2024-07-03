/* eslint-disable no-unused-vars */
import React from 'react';

interface IRadioButton {
  name: string;
  value: string;
  label: string | number;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface RadioButtonProps {
  topic?: string;
  options: IRadioButton[];
  direction: 'row' | 'column';
  onChangeData: (value: any) => void;
  value: string;
  errorMsg?: string;
  className?: string;
  required?: boolean;
}

const RadioButton: React.FC<RadioButtonProps> = ({
  topic,
  options,
  direction,
  onChangeData,
  value,
  errorMsg,
  className,
  required,
}) => (
  <div>
    {topic && (
      <div>
        <p className="naxatw-mb-2 naxatw-text-base naxatw-font-[600]">
          {topic} {required && <span className="naxatw-text-red">*</span>}
        </p>
      </div>
    )}
    <div
      className={`naxatw-flex ${
        direction === 'column'
          ? 'naxatw-flex-col'
          : 'naxatw-flex-wrap naxatw-gap-x-16'
      }`}
    >
      {options.map(option => {
        return (
          <div
            key={option.value}
            className={`naxatw-flex naxatw-items-center naxatw-gap-2 ${
              option?.disabled === true ? 'naxatw-cursor-not-allowed' : ''
            }`}
          >
            <input
              type="radio"
              id={option.value}
              name={option.name}
              value={option.value}
              className={`naxatw-cursor-pointer naxatw-accent-red ${
                option?.disabled === true ? 'naxatw-cursor-not-allowed' : ''
              }`}
              onChange={e => {
                onChangeData(e.target.value);
              }}
              checked={option.value === value}
              disabled={option?.disabled === true}
            />
            <label
              htmlFor={option.value}
              className={`naxatw-mb-[2px] naxatw-flex naxatw-cursor-pointer naxatw-items-center naxatw-gap-2 naxatw-bg-white naxatw-text-base naxatw-text-gray-500 ${className}`}
            >
              <p
                className={`${
                  option?.disabled === true ? 'naxatw-cursor-not-allowed' : ''
                }`}
              >
                {option.label}
              </p>
              <div>{option.icon && option.icon}</div>
            </label>
          </div>
        );
      })}
      {errorMsg && (
        <p className="naxatw-form-error naxatw-py-1 naxatw-text-sm naxatw-text-red">
          {errorMsg}
        </p>
      )}
    </div>
  </div>
);

export default RadioButton;
