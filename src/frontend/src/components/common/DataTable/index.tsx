/* eslint-disable no-unused-vars */
import React, { useState, useMemo, useEffect } from 'react';
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
} from '@tanstack/react-table';
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
import { FlexColumn, FlexRow } from '../Layouts';
import DataTablePagination from './DataTablePagination';
import TableSkeleton from './TableSkeleton';

interface ColumnData {
  header: string;
  accessorKey: string;
  cell?: any;
}

interface DataTableProps {
  columns: ColumnDef<ColumnData>[];
  queryKey: string;
  queryFn: (params: any) => Promise<any>;
  queryFnParams?: Record<string, any>;
  initialState: any;
  searchInput: string;
}

export default function DataTable({
  columns,
  queryKey,
  queryFn,
  initialState,
  searchInput,
  queryFnParams,
}: DataTableProps) {
  const [sorting, setSorting] = useState<ColumnSort[]>([]);
  const defaultData = React.useMemo(() => [], []);

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

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [queryKey, pageIndex, pageSize, searchInput, queryFnParams],
    queryFn: () =>
      queryFn({
        page: pageIndex + 1,
        page_size: pageSize,
        search: searchInput,
        ...(queryFnParams ? prepareQueryParam(queryFnParams) : {}),
      }),
    select: response => response.data,
  });

  useEffect(() => {
    setPagination(prevPagination => ({
      ...prevPagination,
      pageIndex: 0,
    }));
  }, [searchInput]);

  const dataList = useMemo(() => data || [], [data]);

  const pageCounts = (dataList?.count ?? 0) / pageSize;

  const showPagination = dataList?.results?.length >= 10;

  const table = useReactTable({
    data: dataList?.results ?? defaultData,
    columns,
    pageCount: Number.isNaN(pageCounts) ? -1 : Number(Math.ceil(pageCounts)),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      globalFilter: searchInput,
      pagination,
    },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    manualPagination: true,
    debugTable: true,
  });

  if (isLoading) {
    return <TableSkeleton />;
  }

  if (isError) {
    return (
      <div>{isError && <span>Error: {(error as Error).message}</span>}</div>
    );
  }

  return (
    <FlexColumn className="naxatw-gap-2">
      <Table className="">
        <TableHeader>
          {table.getHeaderGroups().map(headerGroup => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <TableHead
                  key={header.id}
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
                            header.column.getIsSorted()
                              ? 'expand_more'
                              : 'expand_less'
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
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map(row => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && 'selected'}
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
      {showPagination && <DataTablePagination table={table} />}
    </FlexColumn>
  );
}
