import { useState, ReactNode } from 'react';
import { FlexRow } from '../Layouts';
import Icon from '../Icon';

interface IAccordionProps {
  open?: boolean;
  title: string | ReactNode;
  description?: string;
  children?: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  onToggle?: (isOpen: boolean) => void;
}

export default function Accordion({
  open = false,
  title,
  description,
  children,
  className = '',
  headerClassName = '',
  contentClassName = '',
  onToggle,
}: IAccordionProps) {
  const [isOpen, setIsOpen] = useState(open);

  const handleToggle = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    onToggle?.(newState);
  };

  return (
    <div className={`naxatw-border-b naxatw-border-b-[#A9A9A9] naxatw-py-8 ${className}`.trim()}>
      <FlexRow className={`naxatw-items-center naxatw-justify-between ${headerClassName}`.trim()}>
        <div className="naxatw-flex-1">
          {typeof title === 'string' ? (
            <p className="naxatw-text-[1.5rem] naxatw-leading-[2rem] md:naxatw-text-[2rem] md:naxatw-leading-[40px]">
              {title}
            </p>
          ) : (
            title
          )}
        </div>
        <button type="button" onClick={handleToggle}>
          {!isOpen ? (
            <Icon name="add_circle_outline" />
          ) : (
            <Icon name="remove_circle_outline" />
          )}
        </button>
      </FlexRow>
      {isOpen && (
        <div className={`naxatw-mt-4 ${contentClassName}`.trim()}>
          {children || (
            <p className="naxatw-text-[1rem] md:naxatw-text-xl md:naxatw-leading-[33px]">
              {description}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
