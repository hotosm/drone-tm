import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Text,
  Legend,
} from 'recharts';
import { ChartFills } from '../constants';
import { IChartProps } from '../types';

function truncateString(str: string, num: number) {
  // If the length of str is less than or equal to num
  // just return str--don't truncate it.
  if (str.length <= num) {
    return str;
  }
  // Return str truncated with '...' concatenated to the end of str.
  return `${str.slice(0, num)}...`;
}

const CustomizedLabel = (props: any) => {
  // eslint-disable-next-line react/prop-types
  const { x, y, payload } = props;
  return (
    <Text
      x={x}
      y={y + 3}
      fontSize={14}
      textAnchor="middle"
      dominantBaseline="hanging"
    >
      {truncateString(payload?.value?.toString() || '', 7)}
    </Text>
  );
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-tooltip naxatw-relative naxatw-z-20 naxatw-rounded-xl naxatw-border-2 naxatw-bg-white naxatw-px-3 naxatw-py-2 naxatw-text-sm naxatw-text-primary-400">
        <p className="label naxatw-font-bold">{label}</p>
        {payload?.map((item: any) => {
          if (item.dataKey !== 'name')
            return (
              <div
                key={item.dataKey}
                className="naxatw-flex naxatw-w-fit naxatw-items-center naxatw-justify-between naxatw-gap-5"
              >
                <div className="naxatw-flex naxatw-items-center naxatw-justify-center naxatw-gap-1">
                  <div
                    className="naxatw-h-3 naxatw-w-3 naxatw-rounded-sm"
                    style={{ backgroundColor: `${item?.fill}` }}
                  />
                  <span>{item.dataKey}</span>
                </div>
                <p className="naxatw-font-semibold">{item.value}</p>
              </div>
            );
          return <></>;
        })}
      </div>
    );
  }

  return null;
};

export default function CustomBarChart({
  data,
  fills = ChartFills,
  scrollable = false,
  width = '150%',
}: IChartProps) {
  // const keys = Object.keys(data.length > 0 ? data[0] : {});
  const dataObject = data.length > 0 ? data[0] : {};

  const { name, ...datax } = dataObject;
  const keys = Object.keys(datax);

  return (
    <ResponsiveContainer
      width={scrollable && width ? width : '100%'}
      minHeight={200}
      maxHeight={230}
    >
      <BarChart
        data={data}
        margin={{
          top: 20,
          right: 0,
          left: 0,
          bottom: 5,
        }}
      >
        <CartesianGrid vertical={false} stroke="#DDD" />
        <XAxis
          dataKey="name"
          style={{
            fontSize: '14px',
            color: '#212121',
          }}
          tickLine={false}
          tick={<CustomizedLabel />}
          interval={0}
        />

        <YAxis
          yAxisId="left"
          style={{
            fontSize: '12px',
            color: '#212121',
          }}
          tickLine={false}
        />
        {keys.length > 1 && <Legend />}

        <Tooltip content={<CustomTooltip />} />
        {keys.map((key, i) => {
          return (
            <Bar
              key={key}
              yAxisId="left"
              dataKey={key}
              fill={fills[i]}
              barSize={22}
              radius={[4, 4, 0, 0]}
            />
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}
