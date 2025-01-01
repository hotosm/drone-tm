import { useMemo } from 'react';
import DataTable from '@Components/common/DataTable';
import { useTypedSelector } from '@Store/hooks';

const tasksDataColumns = [
  {
    header: 'ID',
    accessorKey: 'id',
  },
  {
    header: 'Task Area in km²',
    accessorKey: 'task_area',
  },
  {
    header: 'Flight Time in Minutes',
    accessorKey: 'flight_time_minutes',
  },
  {
    header: 'Flight Distance in km',
    accessorKey: 'flight_distance_km',
  }
];

interface ITableSectionProps {
  isFetching: boolean;
  // eslint-disable-next-line no-unused-vars
  handleTableRowClick: (rowData: any) => {};
}

export default function TableSection({
  isFetching,
  handleTableRowClick,
}: ITableSectionProps) {
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
          task_area: Number(curr?.total_area_sqkm)?.toFixed(3),
          flight_time_minutes: Number(curr?.flight_time_minutes)?.toFixed(3),
          flight_distance_km: Number(curr?.flight_distance_km)?.toFixed(3),
          task_id: curr?.id,
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
      handleTableRowClick={handleTableRowClick}
    />
  );
}
