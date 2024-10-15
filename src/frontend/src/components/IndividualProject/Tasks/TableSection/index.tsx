import DataTable from '@Components/common/DataTable';
import { useTypedSelector } from '@Store/hooks';
import { useMemo } from 'react';

const tasksDataColumns = [
  {
    header: 'ID',
    accessorKey: 'id',
  },
  // {
  //   header: 'Flight Time',
  //   accessorKey: 'flight_time',
  // },
  {
    header: 'Task Area in km²',
    accessorKey: 'task_area',
  },
  // {
  //   header: 'Status',
  //   accessorKey: 'status',
  // },
];

export default function TableSection({ isFetching }: { isFetching: boolean }) {
  const tasksData = useTypedSelector(state => state.project.tasksData);

  const taskDataForTable = useMemo(() => {
    if (!tasksData) return [];
    return tasksData?.reduce((acc: any, curr: any) => {
      if (!(!curr?.state || curr?.state === 'UNLOCKED_TO_MAP')) return acc;
      return [
        ...acc,
        {
          id: `Task# ${curr?.project_task_index}`,
          flight_time: curr?.flight_time || '-',
          task_area: Number(curr?.task_area)?.toFixed(3),
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
      loading={isFetching}
    />
  );
}
