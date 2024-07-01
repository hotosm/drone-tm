import {
  BarChartFills,
  ChartFills,
  HorizontalBarChartFills,
  donutChartFills,
} from '../constants';
import { ChartTypes } from '../types';

export default function getChartFillOfType(type: ChartTypes) {
  switch (type) {
    case 'bar':
      return BarChartFills;
    case 'donut':
      return donutChartFills;
    case 'horizontalBar':
      return HorizontalBarChartFills;
    default:
      return ChartFills;
  }
}
