import { authenticated, api } from '.';

// eslint-disable-next-line import/prefer-default-export
export const postUnflyableComment = ({
  projectId,
  taskId,
  data,
}: {
  projectId?: string;
  taskId?: string;
  data: any;
}) =>
  authenticated(api).post(`/tasks/event/${projectId}/${taskId}`, data, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

export const getImageUploadLink = (replaceExistingImages: boolean, data: any) =>
  authenticated(api).post(
    `/projects/generate-presigned-url/?replace_existing=${replaceExistingImages}`,
    data,
    {
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
