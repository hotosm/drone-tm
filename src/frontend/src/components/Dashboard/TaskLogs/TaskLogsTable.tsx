import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

interface ITaskLogsTableProps {
  data: any[];
}

const TaskLogsTable = ({ data: taskList }: ITaskLogsTableProps) => {
  const navigate = useNavigate();
  return (
    <div className="flex">
      <table className="naxatw-w-full naxatw-overflow-hidden naxatw-rounded-lg">
        <thead>
          <tr className="naxatw-bg-red naxatw-text-left naxatw-font-normal naxatw-text-white">
            <td className="naxatw-w-20 naxatw-border-r-2 naxatw-px-2 naxatw-py-1">
              ID
            </td>
            <td className="naxatw-min-w-30 naxatw-border-r-2 naxatw-px-2 naxatw-py-1">
              Project Name
            </td>
            <td className="naxatw-border-r-2 naxatw-px-2 naxatw-py-1">
              Total task area
            </td>
            {/* <td className="naxatw-border-r-2 naxatw-px-2 naxatw-py-1">
              Est.flight time
            </td> */}
            <td className="naxatw-border-r-2 naxatw-px-2 naxatw-py-1">
              Created Date
            </td>
            <td className="naxatw-border-r-2 naxatw-px-2 naxatw-py-1">
              Status
            </td>
            <td className="naxatw-w-12" />
          </tr>
        </thead>
        <tbody>
          {taskList?.map(task => (
            <tr key={task.task_id}>
              <td className="naxatw-line-clamp-1 naxatw-px-2 naxatw-py-1">
                Task# {task?.project_task_index}
              </td>
              <td className="naxatw-px-2 naxatw-py-1">{task?.project_name}</td>
              <td className="naxatw-px-2 naxatw-py-1">
                {Number(task?.task_area)?.toFixed(3)}
              </td>
              {/* <td className="naxatw-px-2 naxatw-py-1">-</td> */}
              <td className="naxatw-px-2 naxatw-py-1">
                {format(new Date(task.created_at), 'yyyy-MM-dd')}
              </td>
              <td className="naxatw-px-2">{task.state}</td>
              <td className="naxatw-flex naxatw-items-center naxatw-px-2">
                <div
                  className="naxatw-flex naxatw-h-8 naxatw-w-8 naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-lg hover:naxatw-bg-gray-200"
                  role="presentation"
                  onClick={() =>
                    navigate(
                      `/projects/${task.project_id}/tasks/${task.task_id}`,
                    )
                  }
                >
                  <i className="material-icons-outlined">zoom_in</i>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default TaskLogsTable;
