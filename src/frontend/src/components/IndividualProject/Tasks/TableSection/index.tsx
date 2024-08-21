import DataTable from '@Components/common/DataTable';
import { useTypedSelector } from '@Store/hooks';
import { useMemo } from 'react';

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
  // {
  //   header: 'Status',
  //   accessorKey: 'status',
  // },
];

export default function TableSection() {
  const tasksData = useTypedSelector(state => state.project.tasksData);

  const taskDataForTable = useMemo(() => {
    if (!tasksData) return [];
    return tasksData?.reduce((acc: any, curr: any) => {
      if (!(curr?.state === '' || curr?.state === 'UNLOCKED_TO_MAP'))
        return acc;
      return [
        ...acc,
        {
          id: curr?.id,
          flight_time: curr?.flight_time || '-',
          task_area: curr?.task_area,
          // status: curr?.state,
        },
      ];
    }, []);
  }, [tasksData]);

  return (
    <DataTable
      columns={tasksDataColumns}
      wrapperStyle={{
        height: '100%',
      }}
      data={taskDataForTable as Record<string, any>[]}
      withPagination={false}
    />
  );
}
