import { useMemo } from "react";
import DataTable from "@Components/common/DataTable";
import { useTypedSelector } from "@Store/hooks";
import { m } from "@/paraglide/messages";

const tasksDataColumns = [
  {
    header: m.tasks_table_id(),
    accessorKey: "id",
  },
  {
    header: m.tasks_table_task_area_km2(),
    accessorKey: "task_area",
  },
  {
    header: m.tasks_table_flight_time_minutes(),
    accessorKey: "flight_time_minutes",
  },
  {
    header: m.tasks_table_flight_distance_km(),
    accessorKey: "flight_distance_km",
  },
];

interface ITableSectionProps {
  isFetching: boolean;
  // eslint-disable-next-line no-unused-vars
  handleTableRowClick: (rowData: any) => {};
}

export default function TableSection({ isFetching, handleTableRowClick }: ITableSectionProps) {
  const tasksData = useTypedSelector((state) => state.project.tasksData);

  const taskDataForTable = useMemo(() => {
    if (!tasksData) return [];
    return tasksData?.reduce((acc: any, curr: any) => {
      if (!(!curr?.state || curr?.state === "UNLOCKED")) return acc;
      return [
        ...acc,
        {
          id: `Task# ${curr?.project_task_index}`,
          flight_time: curr?.flight_time || "-",
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
        height: "100%",
      }}
      data={taskDataForTable as Record<string, any>[]}
      withPagination={false}
      loading={isFetching}
      handleTableRowClick={handleTableRowClick}
    />
  );
}
