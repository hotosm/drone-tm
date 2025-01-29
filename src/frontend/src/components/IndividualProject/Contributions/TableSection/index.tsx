import DataTable from '@Components/common/DataTable';
import Icon from '@Components/common/Icon';
import { setProjectState } from '@Store/actions/project';
import { useTypedSelector } from '@Store/hooks';
import { formatString } from '@Utils/index';
import { useMemo } from 'react';
import { useDispatch } from 'react-redux';
import { useParams } from 'react-router-dom';
import { toast } from 'react-toastify';

const { COG_URL } = process.env;

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
    cell: function CellComponent({ row }: any) {
      const { original: rowData } = row;
      const dispatch = useDispatch();
      const { id } = useParams();
      const visibleOrthophotoList = useTypedSelector(
        state => state.project.visibleOrthophotoList,
      );

      const handleDownloadResult = () => {
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

      const currentOrthophoto = visibleOrthophotoList?.find(
        (orthophoto: Record<string, any>) =>
          orthophoto?.taskId === rowData.task_id,
      );

      const handleViewResult = () => {
        let newVisibleList: Record<string, any>[] = [];
        if (currentOrthophoto) {
          newVisibleList = visibleOrthophotoList.filter(
            (orthophoto: Record<string, any>) =>
              orthophoto?.taskId !== rowData?.task_id,
          );
        } else {
          newVisibleList = [
            ...visibleOrthophotoList,
            {
              taskId: rowData.task_id,
              source: {
                type: 'raster',
                url: `cog://${COG_URL}/dtm-data/projects/${id}/${rowData?.task_id}/orthophoto/odm_orthophoto.tif`,
                tileSize: 256,
              },
            },
          ];
        }
        dispatch(setProjectState({ visibleOrthophotoList: newVisibleList }));
      };

      return (
        <div className="naxatw-flex naxatw-gap-3">
          <div>
            <div
              className="naxatw-group naxatw-flex naxatw-cursor-pointer naxatw-items-center naxatw-gap-1 naxatw-text-center naxatw-font-semibold naxatw-text-red"
              tabIndex={0}
              role="button"
              onKeyDown={() => {}}
              onClick={() => handleViewResult()}
            >
              <Icon
                className="!naxatw-text-icon-sm"
                name={currentOrthophoto ? 'visibility' : 'visibility_off'}
              />
            </div>
          </div>
          <div
            className="naxatw-group naxatw-flex naxatw-cursor-pointer naxatw-items-center naxatw-gap-1 naxatw-text-center naxatw-font-semibold naxatw-text-red"
            tabIndex={0}
            role="button"
            onKeyDown={() => {}}
            onClick={() => handleDownloadResult()}
          >
            <Icon className="!naxatw-text-icon-sm" name="download" />
          </div>
        </div>
      );
    },
  },
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
      if (!curr?.state || curr?.state === 'UNLOCKED_TO_MAP') return acc;

      return [
        ...acc,
        {
          user: curr?.name || '-',
          task_mapped: `Task# ${curr?.project_task_index}`,
          task_state: formatString(curr?.state),
          assets_url: curr?.assets_url,
          image_count: curr?.total_image_uploaded,
          task_id: curr?.id,
          outline: curr?.outline,
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
      handleTableRowClick={handleTableRowClick}
    />
  );
}
