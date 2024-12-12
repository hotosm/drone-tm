/* eslint-disable no-nested-ternary */
import { Button } from '@Components/RadixComponents/Button';
import { FlexRow } from '@Components/common/Layouts';
import { Input, Select } from '@Components/common/FormUI';
import usePagination, { DOTS } from '@Hooks/usePagination';
import { useMemo } from 'react';
import { rowsPerPageOptions } from '@Constants/index';

interface IPaginationProps {
  totalCount: number;
  siblingCount?: number;
  currentPage: number;
  pageSize: number;
  handlePaginationState: any;
}

export default function Pagination({
  totalCount,
  siblingCount = 1,
  currentPage,
  pageSize,
  handlePaginationState,
}: IPaginationProps) {
  const paginationRange = usePagination({
    currentPage,
    totalCount,
    siblingCount,
    pageSize,
  });

  const lastPage = useMemo(
    () => Number(paginationRange[paginationRange.length - 1]),
    [paginationRange],
  );

  if (currentPage === 0 || paginationRange.length < 2) {
    return null;
  }

  return (
    <FlexRow className="naxatw-fixed naxatw-bottom-0 naxatw-left-0 naxatw-right-0 naxatw-w-full naxatw-flex-col naxatw-items-center naxatw-justify-between naxatw-gap-4 naxatw-bg-white naxatw-px-3 naxatw-py-2.5 md:naxatw-absolute md:naxatw-flex md:naxatw-flex-row md:naxatw-gap-0 lg:naxatw-px-16">
      <FlexRow className="naxatw-w-full naxatw-items-center naxatw-justify-between naxatw-gap-2 md:naxatw-w-[78%]">
        <FlexRow gap={4} className="naxatw-items-center">
          <p className="naxatw-text-sm naxatw-font-bold">Row per page</p>
          <Select
            options={rowsPerPageOptions}
            onChange={value =>
              handlePaginationState({
                selectedNumberOfRows: value,
                activePage: 1,
              })
            }
            selectedOption={pageSize}
            labelKey="label"
            valueKey="value"
            placeholder="Select"
            direction="top"
            className="naxatw-h-9 !naxatw-w-[64px] naxatw-rounded-lg naxatw-border md:!naxatw-w-16"
          />
        </FlexRow>
        <FlexRow gap={2}>
          <FlexRow className="naxatw-items-center naxatw-gap-4">
            <p className="naxatw-text-sm naxatw-font-bold">Go to page</p>
            <Input
              type="number"
              defaultValue={currentPage}
              min={1}
              onChange={e => {
                const page = e.target.value ? Number(e.target.value) : 1;
                const validPage =
                  page >= lastPage ? lastPage : page <= 1 ? 1 : page;
                handlePaginationState({ activePage: validPage });
              }}
              className="no-spinner naxatw-w-8 naxatw-border-b-2 naxatw-px-1 naxatw-py-0 naxatw-text-center"
            />
          </FlexRow>
        </FlexRow>
      </FlexRow>

      <FlexRow className="naxatw-items-center">
        <Button
          size="sm"
          className="!naxatw-text-gray-700"
          leftIcon=" chevron_left"
          onClick={() => handlePaginationState({ activePage: currentPage - 1 })}
          disabled={currentPage <= 1}
        />
        <FlexRow className="naxatw-items-center naxatw-justify-center naxatw-gap-3">
          {paginationRange.map(pageNumber => {
            if (pageNumber === DOTS) {
              return <span key={pageNumber}>&#8230;</span>;
            }
            return (
              <Button
                size="sm"
                key={pageNumber}
                className={`!naxatw-text-gray-500 naxatw-no-underline ${currentPage === pageNumber ? 'naxatw-rounded-b-none naxatw-border-b-2 naxatw-border-gray-800 !naxatw-text-gray-800' : ''}`}
                onClick={() =>
                  handlePaginationState({ activePage: pageNumber })
                }
              >
                {pageNumber}
              </Button>
            );
          })}
        </FlexRow>
        <Button
          size="sm"
          className="!naxatw-text-gray-700"
          disabled={Number(currentPage) >= lastPage}
          onClick={() => handlePaginationState({ activePage: currentPage + 1 })}
          rightIcon="chevron_right"
        />
      </FlexRow>
    </FlexRow>
  );
}
