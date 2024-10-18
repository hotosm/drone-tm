import { useGetAllAssetsUrlQuery } from '@Api/projects';
import DataTable from '@Components/common/DataTable';
import Icon from '@Components/common/Icon';
import { useTypedSelector } from '@Store/hooks';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
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

interface ITableSectionProps {
  isFetching: boolean;
  // eslint-disable-next-line no-unused-vars
  handleTableRowClick: (taskId: string) => {};
}

export default function TableSection({
  isFetching,
  handleTableRowClick,
}: ITableSectionProps) {
  const { id } = useParams();
  const tasksData = useTypedSelector(state => state.project.tasksData);

  const { data: allUrls, isFetching: isUrlFetching } = useGetAllAssetsUrlQuery(
    id as string,
  );

  const getTasksAssets = (taskID: string, assetsList: any[]) => {
    if (!assetsList || !taskID) return null;
    return assetsList.find((assets: any) => assets?.task_id === taskID);
  };

  const taskDataForTable = useMemo(() => {
    if (!tasksData || isUrlFetching) return [];
    return tasksData?.reduce((acc: any, curr: any) => {
      if (!curr?.state || curr?.state === 'UNLOCKED_TO_MAP') return acc;
      const selectedAssetsDetails = getTasksAssets(curr?.id, allUrls as any[]);
      return [
        ...acc,
        {
          user: curr?.name || '-',
          task_mapped: `Task# ${curr?.project_task_index}`,
          task_state: curr?.state,
          assets_url: selectedAssetsDetails?.assets_url,
          image_count: selectedAssetsDetails?.image_count,
        },
      ];
    }, []);
  }, [tasksData, allUrls, isUrlFetching]);

  return (
    <DataTable
      columns={contributionsDataColumns}
      wrapperStyle={{
        height: '100%',
      }}
      data={taskDataForTable as Record<string, any>[]}
      withPagination={false}
      loading={isFetching || isUrlFetching}
      handleTableRowClick={handleTableRowClick}
    />
  );
}
