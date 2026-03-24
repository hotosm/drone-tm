import React, { LazyExoticComponent, ReactNode } from 'react';

type ComponentType =
  | (() => React.JSX.Element)
  // eslint-disable-next-line no-unused-vars
  | ((props: { children?: ReactNode }) => React.JSX.Element);

export interface IRoute {
  id?: number;
  path: string;
  name: string;
  component: ComponentType | LazyExoticComponent<ComponentType>;
  authenticated?: boolean;
  children?: IRoute[];
}
