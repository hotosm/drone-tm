import { useCallback } from 'react';
import Papa from 'papaparse';
import FileSaver from 'file-saver';
import useOutsideClick from '@Hooks/useOutsideClick';
import ToolTip from '@Components/RadixComponents/ToolTip';
import { FlexColumn } from '@Components/common/Layouts';
import CaptureComponent from '../CaptureComponent';

export interface IChartHeaderProps {
  chartTitle: string;
  hasDownloadBtn?: boolean;
  downloadComponentRef: React.RefObject<any>;
  data?: any;
}

export default function ChartHeader({
  chartTitle,
  hasDownloadBtn,
  downloadComponentRef,
  data,
}: IChartHeaderProps) {
  const [toggleRef, toggle, handleToggle] = useOutsideClick();

  const handleDownloadPng = () => {
    CaptureComponent({
      componentRef: downloadComponentRef,
      captureName: chartTitle,
    });
  };
  const handleDownloadCsv = useCallback(async () => {
    if (!data) return;
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });

    FileSaver.saveAs(blob, `${chartTitle}.csv`);
  }, [data, chartTitle]);

  return (
    <div className="naxatw-relative naxatw-flex naxatw-items-start naxatw-justify-between">
      <h3 className="naxatw-relative naxatw-pr-5 naxatw-text-lg naxatw-font-bold naxatw-text-grey-800">
        {chartTitle}
      </h3>

      <div className="naxatw-flex naxatw-items-center naxatw-justify-end naxatw-gap-3">
        {hasDownloadBtn && (
          <div
            ref={toggleRef as React.RefObject<HTMLDivElement>}
            onClick={handleToggle}
            tabIndex={0}
            role="button"
            onKeyDown={() => {}}
            className="actions naxatw-w-40px naxatw-flex naxatw-cursor-pointer
           naxatw-rounded-lg naxatw-p-1 hover:naxatw-bg-primary-50"
          >
            <ToolTip
              name="download"
              message="Download chart"
              className="!naxatw-text-2xl"
            />
          </div>
        )}
      </div>
      {toggle && (
        <FlexColumn
          className=" naxatw-absolute naxatw-right-2 naxatw-top-8 naxatw-z-[100] naxatw-w-[8.3rem]
         naxatw-rounded naxatw-border naxatw-bg-white naxatw-text-center naxatw-text-sm naxatw-shadow-sm"
          data-html2canvas-ignore
        >
          <div
            role="button"
            tabIndex={0}
            onKeyDown={() => {}}
            onClick={handleDownloadPng}
            className="naxatw-py-3 hover:naxatw-bg-primary-50"
          >
            Export as PNG
          </div>
          <div
            role="button"
            tabIndex={0}
            onKeyDown={() => {}}
            onClick={handleDownloadCsv}
            className="naxatw-py-3 hover:naxatw-bg-primary-50"
          >
            Export as CSV
          </div>
        </FlexColumn>
      )}
    </div>
  );
}
