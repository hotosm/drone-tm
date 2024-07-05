import { useState } from 'react';
import { FlexRow } from '../Layouts';
import Icon from '../Icon';

interface IAccordionProps {
  open: boolean;
  title: string;
  description: string;
}

export default function Accordion({
  open = false,
  title,
  description,
}: IAccordionProps) {
  const [isOpen, setIsOpen] = useState(open);
  return (
    <div className="naxatw-border-b naxatw-border-b-[#A9A9A9] naxatw-py-8">
      <FlexRow className="naxatw-items-center naxatw-justify-between">
        <p className="naxatw-text-[1.5rem] naxatw-leading-[2rem] md:naxatw-text-[2rem] md:naxatw-leading-[40px]">
          {title}
        </p>
        <button type="button" onClick={() => setIsOpen(!isOpen)}>
          {!isOpen ? (
            <Icon name="add_circle_outline" />
          ) : (
            <Icon name="remove_circle_outline" />
          )}
        </button>
      </FlexRow>
      {isOpen && (
        <p className="naxatw-mt-4 naxatw-text-[1rem] md:naxatw-text-xl md:naxatw-leading-[33px]">
          {description}
        </p>
      )}
    </div>
  );
}
