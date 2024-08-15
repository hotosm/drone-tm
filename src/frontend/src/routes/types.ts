import { LazyExoticComponent, ReactNode } from 'react';

export interface IRoute {
  id?: number;
  path: string;
  name: string;
  component:
    | LazyExoticComponent<() => JSX.Element>
    | (() => JSX.Element)
    // eslint-disable-next-line no-unused-vars
    | ((props: { children?: ReactNode }) => JSX.Element)
    | (() => JSX.Element)
    | (() => JSX.Element);
  authenticated?: boolean;
  children?: IRoute[];
}
