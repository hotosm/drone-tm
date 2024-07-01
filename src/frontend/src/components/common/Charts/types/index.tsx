/* eslint-disable no-unused-vars */
export interface IChartProps {
  data: Record<string, any>[any];
  fills?: string[];
  scrollable?: boolean;
  width?: string;
}

export type ChartTypes =
  | 'bar'
  | 'donut'
  | 'horizontalBar'
  | 'stackedChart'
  | 'scatterChart';

export interface ILegendProps<T> {
  data: T[];
  onClick?: (key: string) => any;
  type?: ChartTypes;
  fills?: string[];
}

export interface PieChartDataItem {
  name: string;
  value: number;
}

export interface IDonutLegendItemProps {
  color: string;
  name: string;
  value: number | string;
  percentage: number | string;
}

export interface ILegendItemProps {
  color: string;
  name: string;
}
