import { LazyExoticComponent } from 'react';

export interface IRoute {
  id?: number;
  path: string;
  name: string;
  component: LazyExoticComponent<() => JSX.Element> | (() => JSX.Element);
  authenticated?: boolean;
  children?: IRoute[];
}
