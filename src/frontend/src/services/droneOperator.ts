import { authenticated, api } from '.';

// eslint-disable-next-line import/prefer-default-export
export const postUnflyableComment = ({
  projectId,
  taskId,
  data,
}: {
  projectId: string;
  taskId: string;
  data: any;
}) =>
  authenticated(api).post(
    `http://localhost:8000/api/tasks/event/${projectId}/${taskId}`,
    data,
    {
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
