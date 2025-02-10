import React from 'react';

interface IProps {
  aspectRation?: string;
  alt?: string;
  src: string;
  styleClass?: string;
  className?: string;
  width?: any;
}

export default function Image({
  aspectRation,
  styleClass,
  src,
  alt,
  width,
  className,
}: IProps): React.JSX.Element {
  return (
    <div
      className={`image-cover naxatw-aspect-${aspectRation} ${styleClass}} `}
      style={{ aspectRatio: aspectRation }}
    >
      <img src={src} alt={alt} width={width} className={className} />
    </div>
  );
}
