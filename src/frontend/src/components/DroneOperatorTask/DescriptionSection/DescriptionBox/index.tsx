import { useParams } from 'react-router-dom';
import { useGetIndividualTaskQuery } from '@Api/tasks';
import { useTypedSelector } from '@Store/hooks';
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
                name: 'Total task area',
                value: taskData?.task_area ? `${taskData?.task_area} km²` : '-',
              },
              {
                name: 'Est. flight time',
                value: taskData?.flight_time || '-',
              },
            ],
          },
          {
            id: 2,
            title: 'Flight Parameters',
            data: [
              { name: 'Altitude', value: taskData?.altitude || '-' },
              {
                name: 'Gimble Angle',
                value: taskData?.gimble_angles_degrees
                  ? `${taskData?.gimble_angles_degrees} degree`
                  : '-',
              },
              {
                name: 'Front Overlap',
                value: taskData?.front_overlap
                  ? `${taskData?.front_overlap}%`
                  : '-',
              },
              {
                name: 'Side Overlap',
                value: taskData?.side_overlap
                  ? `${taskData?.side_overlap}%`
                  : '-',
              },
              {
                name: 'Starting Point Altitude',
                value: taskData?.starting_point_altitude
                  ? `${taskData?.starting_point_altitude}%`
                  : '-',
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
