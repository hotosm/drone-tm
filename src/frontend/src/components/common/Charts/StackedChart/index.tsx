import { useRef } from 'react';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import RoundedContainer from '@Components/common/RoundedContainer';
import formatNumberWithCommas from '@Utils/formatNumberWithCommas';
import NoDataComponent from '../NoDataComponent';
import { StackedChartFills } from '../constants';
import { IChartHeaderProps } from '../ChartHeader';

interface IStackedChartProps
  extends Omit<IChartHeaderProps, 'downloadComponentRef'> {
  hasHeader?: boolean;
  // eslint-disable-next-line no-unused-vars
  header: (props: IChartHeaderProps) => JSX.Element;
  data: Record<string, any>;
  className?: string;
  labelAlignment?: 'vertical' | 'horizontal';
}
type IUpdatedData = {
  name: string;
  color: string;
  width: string;
  value: number;
}[];

export default function StackedChart({
  hasHeader = true,
  header,
  data,
  className,
  labelAlignment,
  chartTitle,
  hasDownloadBtn,
}: IStackedChartProps) {
  const componentRef = useRef(null);
  const total =
    data.reduce(
      (sum: number, item: Record<string, any>) => sum + item.value,
      0,
    ) || 0;

  const updatedData: IUpdatedData = data.map(
    (item: Record<string, any>, index: number) => ({
      ...item,
      width: `${((item.value / total) * 100).toFixed(0)}%`,
      color: StackedChartFills[index],
    }),
  );

  const isDataEmpty = !!data.length;

  return (
    <RoundedContainer
      ref={componentRef}
      className={`naxatw-bg-primary-50 naxatw-flex naxatw-min-h-full naxatw-w-full naxatw-flex-1 naxatw-flex-col naxatw-rounded-xl naxatw-px-5 naxatw-py-3 naxatw-shadow-md ${className}`}
    >
      {hasHeader && header && (
        <div className="head naxatw-col-span-12 naxatw-h-fit">
          <div className="cover">
            {header({
              chartTitle,
              hasDownloadBtn,
              downloadComponentRef: componentRef,
              data,
            })}
          </div>
        </div>
      )}
      {isDataEmpty ? (
        <FlexColumn className={`${hasDownloadBtn ? 'naxatw-gap-5' : ''}`}>
          <FlexRow className="naxatw-mt-1 naxatw-overflow-hidden naxatw-rounded">
            {updatedData.map(({ name, color, width }) => (
              <div
                key={name}
                className="naxatw-h-4"
                style={{
                  width,
                  backgroundColor: color,
                }}
              />
            ))}
          </FlexRow>
          <div
            className={`naxatw-flex naxatw-pt-1 ${
              labelAlignment === 'vertical'
                ? 'naxatw-flex-col naxatw-gap-2'
                : 'naxatw-mt-1 naxatw-flex-col md:naxatw-flex-row md:naxatw-justify-between'
            }`}
          >
            {updatedData.map(({ name, value, color }) => (
              <FlexRow key={name} className="naxatw-items-center naxatw-gap-2">
                <div
                  className={`naxatw-h-3 naxatw-w-3 ${
                    labelAlignment === 'vertical'
                      ? 'naxatw-rounded'
                      : 'naxatw-rounded-full'
                  } `}
                  style={{
                    backgroundColor: color,
                  }}
                />
                <FlexRow
                  className={` ${
                    labelAlignment === 'vertical'
                      ? 'naxatw-gap-10'
                      : 'naxatw-w-full naxatw-gap-0.5'
                  }`}
                >
                  <FlexRow
                    className={`naxatw-items-center naxatw-text-sm naxatw-capitalize naxatw-text-grey-800 ${
                      labelAlignment === 'horizontal'
                        ? 'naxatw-pt-0.5'
                        : 'naxatw-w-40'
                    } `}
                  >
                    {name}
                  </FlexRow>
                  <h5
                    className={` ${
                      labelAlignment === 'vertical'
                        ? 'naxatw-text-sm'
                        : 'naxatw-ml-auto'
                    }`}
                  >
                    {formatNumberWithCommas(value)}
                  </h5>
                </FlexRow>
              </FlexRow>
            ))}
          </div>
        </FlexColumn>
      ) : (
        <NoDataComponent />
      )}
    </RoundedContainer>
  );
}
