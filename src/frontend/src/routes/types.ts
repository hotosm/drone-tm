import React, { LazyExoticComponent, ReactNode } from 'react';

export interface IRoute {
  id?: number;
  path: string;
  name: string;
  component:
    | LazyExoticComponent<() => React.JSX.Element>
    | (() => React.JSX.Element)
    // eslint-disable-next-line no-unused-vars
    | ((props: { children?: ReactNode }) => React.JSX.Element)
    | (() => React.JSX.Element)
    | (() => React.JSX.Element);
  authenticated?: boolean;
  children?: IRoute[];
}
