import { useParams } from 'react-router-dom';
import { useGetIndividualTaskQuery } from '@Api/tasks';
import { useTypedSelector } from '@Store/hooks';
import { format } from 'date-fns';
import DescriptionBoxComponent from './DescriptionComponent';
import QuestionBox from '../QuestionBox';

const DescriptionBox = () => {
  const secondPageStates = useTypedSelector(state => state.droneOperatorTask);
  const { secondPage } = secondPageStates;
  const { taskId } = useParams();

  const { data: taskDescription }: Record<string, any> =
    useGetIndividualTaskQuery(taskId as string, {
      select: (data: any) => {
        const { data: taskData } = data;

        return [
          {
            id: 1,
            title: 'Task Description',
            data: [
              {
                name: 'Created date',
                value: taskData?.created_at
                  ? format(new Date(taskData?.created_at), 'yyyy-mm-dd')
                  : null,
              },
              {
                name: 'Total task area',
                value: taskData?.task_area
                  ? `${Number(taskData?.task_area)?.toFixed(3)} km²`
                  : null,
              },
              {
                name: 'Est. flight time',
                value: taskData?.flight_time || null,
              },
            ],
          },
          {
            id: 2,
            title: 'Flight Parameters',
            data: [
              { name: 'Altitude', value: taskData?.altitude || null },
              {
                name: 'Gimble Angle',
                value: taskData?.gimble_angles_degrees
                  ? `${taskData?.gimble_angles_degrees} degree`
                  : null,
              },
              {
                name: 'Front Overlap',
                value: taskData?.front_overlap
                  ? `${taskData?.front_overlap}%`
                  : null,
              },
              {
                name: 'Side Overlap',
                value: taskData?.side_overlap
                  ? `${taskData?.side_overlap}%`
                  : null,
              },
              {
                name: 'GSD',
                value: taskData?.gsd_cm_px ? `${taskData?.gsd_cm_px} cm` : null,
              },
              {
                name: 'Starting Point Altitude',
                value: taskData?.starting_point_altitude
                  ? `${taskData?.starting_point_altitude}`
                  : null,
              },
            ],
          },
        ];
      },
    });

  return (
    <>
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-5">
        {taskDescription?.map((description: Record<string, any>) => (
          <DescriptionBoxComponent
            key={description.id}
            title={description.title}
            data={description?.data}
          />
        ))}
      </div>
      {!secondPage && <QuestionBox />}
    </>
  );
};

export default DescriptionBox;
