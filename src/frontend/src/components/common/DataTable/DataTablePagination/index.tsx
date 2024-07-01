import { Input } from '@Components/common/FormUI';
import { FlexRow } from '@Components/common/Layouts';
import { Button } from '@Components/RadixComponents/Button';

export default function DataTablePagination({ table }: any) {
  return (
    <FlexRow className="naxatw-justify-between naxatw-py-2">
      <FlexRow className="naxatw-items-center naxatw-gap-2 ">
        Row per page
        <select
          value={table.getState().pagination.pageSize}
          onChange={e => {
            table.setPageSize(Number(e.target.value));
          }}
          className=" naxatw-rounded-lg naxatw-border-2 naxatw-border-grey-500 naxatw-p-1.5"
        >
          {[10, 25, 50, 100].map(page => (
            <option key={page} value={page}>
              {page}
            </option>
          ))}
        </select>
      </FlexRow>
      <FlexRow className="naxatw-gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Prev
        </Button>
        <Button
          size="sm"
          onClick={() => table.setPageIndex(0)}
          disabled={!table.getCanPreviousPage()}
        >
          01
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => table.setPageIndex(table.getPageCount() - 1)}
          disabled={!table.getCanNextPage()}
        >
          {table.getPageCount()}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </Button>

        <FlexRow className="naxatw-items-center naxatw-gap-1 ">
          <div>Page</div>
          <strong>
            {table.getState().pagination.pageIndex + 1} of &nbsp;
            {table.getPageCount()}
          </strong>
        </FlexRow>
        <FlexRow className="naxatw-items-center naxatw-gap-1">
          | Go to page:
          <Input
            type="number"
            defaultValue={table.getState().pagination.pageIndex + 1}
            onChange={e => {
              const page = e.target.value ? Number(e.target.value) - 1 : 0;
              table.setPageIndex(page);
            }}
            className="naxatw-w-16 naxatw-rounded naxatw-border naxatw-p-1"
          />
        </FlexRow>
      </FlexRow>
    </FlexRow>
  );
}
