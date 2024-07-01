import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartFills } from '../constants';
import { IChartProps } from '../types';

export default function ScatterChartComponent({
  data,
  fills = ChartFills,
  scrollable = false,
  width = '150%',
}: IChartProps) {
  return (
    <ResponsiveContainer
      minHeight={150}
      maxHeight={230}
      width={scrollable && width ? width : '100%'}
    >
      <ScatterChart
        margin={{
          top: 20,
          right: 0,
          bottom: 0,
          left: 5,
        }}
      >
        <CartesianGrid vertical={false} stroke="#DDD" />

        <XAxis
          dataKey="name"
          style={{
            fontSize: '13.4px',
            color: '#484848',
          }}
          name="House Floor"
          tickLine={false}
        />
        <YAxis
          dataKey="value"
          type="number"
          style={{
            fontSize: '12px',
            color: '#484848',
          }}
          name="Number of House"
          tickLine={false}
        />
        {/* <ZAxis
          dataKey="value"
          type="number"
          range={[64, 144]}
          name="Number of house"
        /> */}
        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
        {/* <Legend /> */}
        <Scatter data={data} name="House Floors" fill={fills[0]} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
