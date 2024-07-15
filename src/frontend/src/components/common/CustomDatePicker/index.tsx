/* eslint-disable no-unused-vars */
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

type CustomDatePickerType = {
  title: string;
  className: string;
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
};

const CustomDatePicker = ({
  title,
  className,
  selectedDate,
  setSelectedDate,
}: CustomDatePickerType) => {
  return (
    <div className="naxatw-z-[10000] naxatw-w-full">
      {title && (
        <p
          className={`naxatw-mb-2 !naxatw-bg-transparent naxatw-text-[1rem] naxatw-font-semibold ${className}`}
        >
          {title}
        </p>
      )}
      <DatePicker
        selected={selectedDate}
        onChange={(date: any) => setSelectedDate(date)}
        className="naxawtw-pt-1 hover naxatw-z-50 naxatw-h-[2rem] naxatw-w-full naxatw-border-[1px] naxatw-border-gray-300 naxatw-px-2 naxatw-text-base naxatw-outline-none"
        placeholderText="YYYY/MM/DD"
        dateFormat="yyyy/MM/dd"
      />
    </div>
  );
};

export default CustomDatePicker;
