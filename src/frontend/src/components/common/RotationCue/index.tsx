/* eslint-disable no-unused-vars */
import React, { useEffect, useState } from 'react';

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
  const radius = 56; // Adjust to match circle size (half of `naxatw-h-28`)

  const calculateAngle = (
    clientX: number,
    clientY: number,
    circle: DOMRect,
  ) => {
    const centerX = circle.left + circle.width / 2;
    const centerY = circle.top + circle.height / 2;

    const radians = Math.atan2(clientY - centerY, clientX - centerX);
    const degrees = (radians * (180 / Math.PI) + 360) % 360;

    return degrees;
  };

  const handleStart = (clientX: number, clientY: number, circle: DOMRect) => {
    const degrees = calculateAngle(clientX, clientY, circle);
    setStartAngle(degrees - rotation); // Offset for smooth dragging
    setDragging(true);
  };

  const handleMove = (clientX: number, clientY: number, circle: DOMRect) => {
    if (!dragging) return;

    const degrees = calculateAngle(clientX, clientY, circle);

    let rotationDelta = degrees - startAngle;
    if (rotationDelta < 0) {
      rotationDelta += 360;
    }

    setRotation(rotationDelta);
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const { clientX, clientY } = event;
    const circle = (event.target as HTMLElement).getBoundingClientRect();
    handleStart(clientX, clientY, circle);
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging) return;

    const { clientX, clientY } = event;
    const circle = (event.target as HTMLElement).getBoundingClientRect();
    handleMove(clientX, clientY, circle);
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const { clientX, clientY } = event.touches[0];
    const circle = (event.target as HTMLElement).getBoundingClientRect();
    handleStart(clientX, clientY, circle);
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!dragging) return;

    const { clientX, clientY } = event.touches[0];
    const circle = (event.target as HTMLElement).getBoundingClientRect();
    handleMove(clientX, clientY, circle);
  };

  const handleEnd = () => {
    setDragging(false);
  };
  useEffect(() => {
    const preventDefault = (e: TouchEvent | WheelEvent) => {
      e.preventDefault();
    };

    // Disable scroll on mobile devices
    document.body.style.overflow = 'hidden'; // Disable page scroll
    window.addEventListener('touchmove', preventDefault, { passive: false });
    window.addEventListener('wheel', preventDefault, { passive: false });

    return () => {
      window.removeEventListener('touchmove', preventDefault);
      window.removeEventListener('wheel', preventDefault);
      document.body.style.overflow = ''; // Restore page scroll on cleanup
    };
  }, []);
  // Calculate handle position
  const radians = (rotation * Math.PI) / 180;
  const handleX = radius + radius * Math.cos(radians);
  const handleY = radius + radius * Math.sin(radians);

  return (
    <div
      className="naxatw-relative naxatw-flex naxatw-h-48 naxatw-w-48 naxatw-flex-col naxatw-items-center naxatw-justify-center naxatw-bg-transparent"
      onMouseMove={handleMouseMove}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleEnd}
      role="presentation"
    >
      {/* Circle */}
      <div
        className="naxatw-relative naxatw-flex naxatw-h-28 naxatw-w-28 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-border-4 naxatw-border-red naxatw-bg-white naxatw-outline naxatw-outline-4 naxatw-outline-white"
        role="presentation"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {/* Handle */}
        <div
          className="naxatw-absolute naxatw-h-5 naxatw-w-5 naxatw-cursor-grab naxatw-rounded-full naxatw-bg-red naxatw-outline naxatw-outline-white"
          style={{
            left: `${handleX - 10}px`, // Offset by half of handle size to center
            top: `${handleY - 10}px`, // Offset by half of handle size to center
          }}
        />
      </div>
      {/* Rotation Display */}
    </div>
  );
};

export default RotationCue;
