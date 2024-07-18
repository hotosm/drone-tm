import DataTable from '@Components/common/DataTable';

export default function TableSection() {
  const tasksDataColumns = [
    {
      header: 'User',
      accessorKey: 'user',
    },
    {
      header: 'Task Mapped',
      accessorKey: 'task_mapped',
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
