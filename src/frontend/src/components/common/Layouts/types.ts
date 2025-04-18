import React from 'react';
import type { MouseEventHandler, ReactNode } from 'react';

type divPropsType = React.JSX.IntrinsicElements['div'];

export interface IFlexContainerProps extends divPropsType {
  className?: string;
  children?: ReactNode;
  gap?: number;
  row?: string;
  md?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  [key: string]: any; // Allow any other props
}

export interface IGridContainerProps extends divPropsType {
  className?: string;
  children?: ReactNode;
  cols?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 'none';
  gap?: number;
  [key: string]: any; // Allow any other props
}
