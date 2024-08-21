import DataTable from '@Components/common/DataTable';
import { useTypedSelector } from '@Store/hooks';
import { useMemo } from 'react';

const contributionsDataColumns = [
  {
    header: 'User',
    accessorKey: 'user',
  },
  {
    header: 'Task Mapped',
    accessorKey: 'task_mapped',
  },
  {
    header: 'Task Status',
    accessorKey: 'task_state',
  },
];

export default function TableSection() {
  const tasksData = useTypedSelector(state => state.project.tasksData);

  const taskDataForTable = useMemo(() => {
    if (!tasksData) return [];
    return tasksData?.reduce((acc: any, curr: any) => {
      if (!curr?.state || curr?.state === 'UNLOCKED_TO_MAP') return acc;
      return [
        ...acc,
        {
          user: curr?.name || '-',
          task_mapped: curr?.id,
          task_state: curr?.state,
        },
      ];
    }, []);
  }, [tasksData]);

  return (
    <DataTable
      columns={contributionsDataColumns}
      wrapperStyle={{
        height: '100%',
      }}
      data={taskDataForTable as Record<string, any>[]}
      withPagination={false}
    />
  );
}
