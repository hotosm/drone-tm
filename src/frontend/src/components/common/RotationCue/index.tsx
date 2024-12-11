/* eslint-disable no-unused-vars */
import React, { useState } from 'react';

type RotationCueProps = {
  setRotation: (rotation: number) => void;
  rotation: number;
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
};
const RotationCue = ({
  setRotation,
  rotation,
  setDragging,
  dragging,
}: RotationCueProps) => {
  const [startAngle, setStartAngle] = useState(0);

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const { clientX, clientY } = event;
    const circle = (event.target as HTMLElement).getBoundingClientRect();
    const centerX = circle.left + circle.width / 2;
    const centerY = circle.top + circle.height / 2;

    const radians = Math.atan2(clientY - centerY, clientX - centerX);
    const degrees = (radians * (180 / Math.PI) + 360) % 360;
    setStartAngle(degrees - rotation); // Offset for smooth dragging
    setDragging(true);
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging) return;

    const { clientX, clientY } = event;
    const circle = (event.target as HTMLElement).getBoundingClientRect();
    const centerX = circle.left + circle.width / 2;
    const centerY = circle.top + circle.height / 2;

    const radians = Math.atan2(clientY - centerY, clientX - centerX);
    const degrees = (radians * (180 / Math.PI) + 360) % 360;

    let rotationDelta = degrees - startAngle;
    if (rotationDelta < 0) {
      rotationDelta += 360;
    }

    setRotation(rotationDelta);
  };

  const handleMouseUp = () => {
    setDragging(false);
  };

  return (
    <div
      className="naxatw-flex naxatw-h-48 naxatw-w-48 naxatw-flex-col naxatw-items-center naxatw-justify-center naxatw-bg-transparent"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      role="presentation"
    >
      <div
        className="naxatw-relative naxatw-flex naxatw-h-28 naxatw-w-28 naxatw-cursor-grab naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-border-2 naxatw-border-red naxatw-bg-white"
        onMouseDown={handleMouseDown}
        role="presentation"
      >
        {/* Rotating Line */}
        <div
          className="naxatw-absolute naxatw-top-3 naxatw-h-10 naxatw-w-1 naxatw-origin-bottom naxatw-bg-red"
          style={{
            transform: `rotate(${rotation}deg)`,
          }}
        />

        {/* Static Center */}
        <p className="naxatw-absolute naxatw-bottom-4 naxatw-select-none naxatw-text-sm">
          {rotation.toFixed(2)}
        </p>
        <div className="naxatw-absolute naxatw-h-4 naxatw-w-4 naxatw-rounded-full naxatw-bg-red" />
      </div>
    </div>
  );
};

export default RotationCue;
