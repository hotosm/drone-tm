import Icon from '@Components/common/Icon';

interface IOutputOptionsProps {
  icon: any;
  name: string;
  checked: boolean;
  label: string;
  register: any;
}

const OutputOptions = ({
  icon,
  name,
  checked,
  label,
  register,
}: IOutputOptionsProps) => {
  return (
    <label
      className={`naxatw-relative naxatw-flex naxatw-h-[86px] naxatw-max-w-[156px] naxatw-cursor-pointer naxatw-justify-center naxatw-rounded hover:naxatw-bg-redlight ${checked ? 'naxatw-bg-redlight' : ''}`}
    >
      <div
        id={label}
        className="naxatw-flex naxatw-items-center naxatw-justify-center"
      >
        <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-justify-center">
          <img src={icon} alt="" sizes="" />
          <div>{label}</div>
        </div>
      </div>
      <input
        name={name}
        id={label}
        type="checkbox"
        checked={checked}
        className="naxatw-absolute naxatw-opacity-0"
        value={label}
        {...register(name)}
      />
      {checked && (
        <div className="naxatw-absolute naxatw-right-2 naxatw-top-2 naxatw-flex naxatw-h-4 naxatw-w-4 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-border naxatw-border-red">
          <Icon name="check" className="!naxatw-text-sm naxatw-text-red" />
        </div>
      )}
    </label>
  );
};

export default OutputOptions;
