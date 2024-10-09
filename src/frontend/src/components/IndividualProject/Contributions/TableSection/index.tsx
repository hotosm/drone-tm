import DataTable from '@Components/common/DataTable';
import Icon from '@Components/common/Icon';
import { useTypedSelector } from '@Store/hooks';
import { useMemo } from 'react';
import { toast } from 'react-toastify';

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
  { header: 'Image count', accessorKey: 'image_count' },

  {
    header: 'Orthophoto',
    accessorKey: 'assets_url',
    cell: ({ row }: any) => {
      const handleDownloadResult = () => {
        const { original: rowData } = row;
        if (!rowData?.assets_url) return;
        try {
          const link = document.createElement('a');
          link.href = rowData?.assets_url;
          link.download = 'assets.zip';
          document.body.appendChild(link);
          link.click();
          link.remove();
        } catch (error) {
          toast.error(`There wan an error while downloading file ${error}`);
        }
      };

      return (
        <div
          className="naxatw-group naxatw-flex naxatw-cursor-pointer naxatw-items-center naxatw-gap-1 naxatw-text-center naxatw-font-semibold naxatw-text-red"
          tabIndex={0}
          role="button"
          onKeyDown={() => {}}
          onClick={() => handleDownloadResult()}
        >
          <div className="group-hover:naxatw-underline">Download</div>
          <Icon className="!naxatw-text-icon-sm" name="download" />
        </div>
      );
    },
  },
];

export default function TableSection({ isFetching }: { isFetching: boolean }) {
  const tasksData = useTypedSelector(state => state.project.tasksData);

  const taskDataForTable = useMemo(() => {
    if (!tasksData) return [];
    return tasksData?.reduce((acc: any, curr: any) => {
      if (!curr?.state || curr?.state === 'UNLOCKED_TO_MAP') return acc;
      return [
        ...acc,
        {
          user: curr?.name || '-',
          task_mapped: `Task# ${curr?.project_task_index}`,
          task_state: curr?.state,
          assets_url: curr?.assets_url,
          image_count: curr?.image_count,
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
      loading={isFetching}
    />
  );
}
