/* eslint-disable no-unused-vars */
/* eslint-disable react/prop-types */

import { HtmlHTMLAttributes, useRef } from 'react';
import { cn } from '@Utils/index';
import RoundedContainer from '@Components/common/RoundedContainer';
import getChartOfType from '../utils/getChartOfType';
import getChartFillOfType from '../utils/getChartFillOfType';
import { IChartHeaderProps } from '../ChartHeader';
import { ChartTypes, ILegendProps } from '../types';
import { ChartFills } from '../constants';

interface ICustomChartContainerProps<T>
  extends HtmlHTMLAttributes<HTMLDivElement>,
    Omit<IChartHeaderProps, 'downloadComponentRef'> {
  header: (props: IChartHeaderProps) => JSX.Element;
  type: ChartTypes;
  data: T[];
  legend?: (props: ILegendProps<T>) => JSX.Element;
  xLabel?: string;
  yLabel?: string;
  scrollable?: boolean;
  fillWithType?: boolean;
  fill?: string[];
  hasHeader?: boolean;
}

export default function ChartContainer<T>({
  header,
  legend,
  xLabel,
  yLabel,
  className,
  data,
  type,
  chartTitle,
  hasDownloadBtn,
  scrollable = false,
  fillWithType = false,
  fill,
  hasHeader = true,
}: ICustomChartContainerProps<T>) {
  const componentRef = useRef(null);
  const chart = getChartOfType(type);

  const fills = fill || (fillWithType ? getChartFillOfType(type) : ChartFills);

  return (
    <RoundedContainer
      ref={componentRef}
      className={cn(
        'naxatw-relative naxatw-grid naxatw-h-full naxatw-w-full naxatw-grid-cols-12 naxatw-gap-7 naxatw-bg-grey-50 naxatw-px-4 naxatw-py-2',
        className,
      )}
    >
      {hasHeader && header && (
        <div className="head naxatw-col-span-12 naxatw-h-fit">
          <div className="cover">
            {header({
              chartTitle,
              hasDownloadBtn,
              downloadComponentRef: componentRef,
            })}
          </div>
        </div>
      )}

      {yLabel && !(type === 'donut') ? (
        <div className="y-label naxatw-absolute naxatw-left-0 naxatw-top-0 naxatw-col-span-1 naxatw-flex naxatw-h-full naxatw-w-12 naxatw-items-center naxatw-justify-end">
          <p className="naxatw-origin-center -naxatw-rotate-90 naxatw-whitespace-nowrap naxatw-text-xs">
            {yLabel}
          </p>
        </div>
      ) : null}

      <div
        className={`card ${
          // eslint-disable-next-line no-nested-ternary
          type === 'donut'
            ? 'naxatw-col-span-12 naxatw-flex  naxatw-h-full naxatw-items-center sm:naxatw-col-span-6 md:naxatw-col-span-12 lg:naxatw-col-span-6 '
            : yLabel
              ? 'naxatw-col-span-12'
              : 'naxatw-col-span-12  naxatw-h-full naxatw-overflow-y-hidden'
        } ${scrollable ? 'scrollbar naxatw-overflow-auto' : ''}`}
      >
        {chart && chart({ data, fills, scrollable })}
      </div>
      {xLabel && !(type === 'donut') ? (
        <div className="x-label naxatw-col-span-12 naxatw-flex naxatw-h-[2rem] naxatw-items-center naxatw-justify-center">
          <p className="naxatw-mr-2">{xLabel}</p>
        </div>
      ) : null}
      {legend && (
        <div
          className={`legend ${
            type === 'donut'
              ? 'naxatw-col-span-12 naxatw-flex naxatw-items-center naxatw-justify-start  sm:naxatw-col-span-6 md:naxatw-col-span-12 lg:naxatw-col-span-6'
              : 'naxatw-col-span-11 naxatw-col-start-1 naxatw-col-end-13'
          } `}
        >
          {legend({
            data,
            type,
            fills,
          })}
        </div>
      )}
    </RoundedContainer>
  );
}
