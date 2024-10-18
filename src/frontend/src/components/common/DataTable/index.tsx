/* eslint-disable react/no-array-index-key */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-unused-vars */
import React, { useState, useMemo, useEffect, CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  PaginationState,
  ColumnSort,
  ColumnDef,
  TableOptions,
} from '@tanstack/react-table';
import { AxiosResponse } from 'axios';
import prepareQueryParam from '@Utils/prepareQueryParam';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@Components/RadixComponents/Table';
import Icon from '@Components/common/Icon';
import Skeleton from '@Components/RadixComponents/Skeleton';
import useDebounceListener from '@Hooks/useDebouncedListener';
import { FlexColumn, FlexRow } from '../Layouts';
import Pagination from './DataTablePagination';

export interface ColumnData {
  header: string;
  accessorKey: string;
  cell?: any;
}

interface DataTableProps {
  columns: ColumnDef<ColumnData>[];
  queryKey?: string;
  queryFn?: (params: any) => Promise<AxiosResponse<any, any>>;
  queryFnParams?: Record<string, any>;
  initialState?: any;
  searchInput?: string;
  wrapperStyle?: CSSProperties;
  sortingKeyMap?: Record<string, any>;
  withPagination?: boolean;
  tableOptions?: Partial<TableOptions<ColumnData>>;
  useQueryOptions?: Record<string, any>;
  data?: Record<string, any>[];
  loading?: boolean;
  handleTableRowClick?: any;
}

const defaultPaginationState = {
  paginationState: {
    pageIndex: 0,
    pageSize: 25,
  },
};

export default function DataTable({
  columns,
  queryKey,
  queryFn,
  initialState = { ...defaultPaginationState },
  searchInput,
  queryFnParams,
  wrapperStyle,
  sortingKeyMap,
  withPagination = true,
  tableOptions = { manualSorting: true },
  useQueryOptions,
  data,
  loading,
  handleTableRowClick,
}: DataTableProps) {
  const [sorting, setSorting] = useState<ColumnSort[]>([]);
  const debouncedValue = useDebounceListener(searchInput || '', 800);
  const [{ pageIndex, pageSize }, setPagination] =
    React.useState<PaginationState>({
      pageIndex: 0,
      pageSize: 10,
      ...initialState.paginationState,
    });
  const pagination = React.useMemo(
    () => ({
      pageIndex,
      pageSize,
    }),
    [pageIndex, pageSize],
  );

  const {
    data: queryData,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: [
      queryKey,
      pageIndex,
      pageSize,
      debouncedValue,
      queryFnParams,
      sorting,
    ],
    queryFn: () =>
      queryFn?.({
        page: pageIndex + 1,
        page_size: pageSize,
        search: debouncedValue,
        ...(queryFnParams ? prepareQueryParam(queryFnParams) : {}),
        ordering: sorting
          .map(item => {
            const sortingKey = sortingKeyMap?.[item.id] || item.id;
            return item.desc ? `-${sortingKey}` : sortingKey;
          })
          .join(', '),
      }) || null,
    select: (res: any) => res.data,
    enabled: !data, // do not fetch data when there props data
    ...useQueryOptions,
  });

  useEffect(() => {
    setPagination(prevPagination => ({
      ...prevPagination,
      pageIndex: 0,
    }));
  }, [searchInput, queryFnParams]);

  // handle data from outside or queryData
  const dataList = useMemo(() => data || queryData || [], [queryData, data]);

  const pageCounts = (dataList?.count ?? 0) / pageSize;

  const table = useReactTable({
    data: Array.isArray(dataList) ? dataList : (dataList?.results ?? []),
    columns,
    pageCount: Number.isNaN(pageCounts) ? -1 : Number(Math.ceil(pageCounts)),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      globalFilter: searchInput,
      pagination,
      ...(tableOptions?.manualSorting ? { sorting } : {}),
    },
    onPaginationChange: setPagination,
    manualPagination: true,
    enableSortingRemoval:
      false /* sort in order 'none' -> 'desc' -> 'asc' -> 'desc' -> 'asc' -> ... */,
    manualSorting: true,
    manualFiltering: true,
    debugTable: true,
    ...(tableOptions?.manualSorting ? { onSortingChange: setSorting } : {}),
    ...tableOptions,
  });

  function getErrorMsg(err: any): string {
    if (err && err.response && err.response.data && err.response.data.message) {
      return err.response.data.message;
    }
    return 'An unexpected error occurred.';
  }

  if (isError) {
    return (
      <div>
        <span>Error: {getErrorMsg(error)}</span>
      </div>
    );
  }

  return (
    <FlexColumn gap={3} style={wrapperStyle}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map(headerGroup => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <TableHead
                  className="naxatw-bg-red"
                  key={`${header.id}-${header.index}`}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {!header.isPlaceholder && (
                    <FlexRow className="naxatw-cursor-pointer naxatw-items-center">
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {/* @ts-ignore */}
                      {header.column.columnDef.accessorKey.startsWith(
                        'icon',
                      ) ? null : (
                        <Icon
                          name={
                            header.column.getIsSorted() === 'desc'
                              ? 'arrow_drop_up'
                              : 'arrow_drop_down'
                          }
                        />
                      )}
                    </FlexRow>
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {loading || (!data && isLoading) ? (
            Array.from({ length: !data && isLoading ? 12 : 5 }).map(
              (_, idx) => (
                <TableRow key={idx}>
                  {columns.map((cell, index) => {
                    return (
                      <TableCell
                        key={index}
                        className={cell.header === '' ? 'naxatw-w-[130px]' : ''}
                      >
                        <Skeleton className="naxatw-my-1.5 naxatw-h-4 naxatw-w-8/12 naxatw-bg-grey-400" />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ),
            )
          ) : table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map(row => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && 'selected'}
                onClick={() => {
                  handleTableRowClick?.(row?.original);
                }}
              >
                {row.getVisibleCells().map(cell => (
                  <TableCell key={cell.id}>
                    {cell.getValue() !== null
                      ? flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )
                      : '-'}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="naxatw-text-center"
              >
                No Data found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      {withPagination && (
        <Pagination
          currentPage={table.getState().pagination.pageIndex + 1}
          totalCount={dataList.count}
          pageSize={pageSize}
          table={table}
        />
      )}
    </FlexColumn>
  );
}
