import DataTable from '@Components/common/DataTable';

export default function TableSection() {
  const tasksDataColumns = [
    {
      header: 'ID',
      accessorKey: 'id',
    },
    {
      header: 'Flight Time',
      accessorKey: 'flight_time',
    },
    {
      header: 'Task Area',
      accessorKey: 'task_area',
    },
    {
      header: 'Status',
      accessorKey: 'status',
    },
  ];
  return (
    <DataTable
      columns={tasksDataColumns}
      wrapperStyle={{
        height: '100%',
      }}
      data={[]}
      withPagination={false}
    />
  );
}
