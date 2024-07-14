import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useTypedSelector, useTypedDispatch } from '@Store/hooks';
import { FlexRow } from '@Components/common/Layouts';
import {
  StepComponentMap,
  stepDescriptionComponents,
} from '@Constants/createProject';
import { Button } from '@Components/RadixComponents/Button';
import { setCreateProjectState } from '@Store/actions/createproject';
import {
  BasicInformationForm,
  DefineAOIForm,
  KeyParametersForm,
  ContributionsForm,
  GenerateTaskForm,
} from '@Components/CreateProject/FormContents';
import { postCreateProject, postTaskBoundary } from '@Services/createproject';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { convertGeojsonToFile } from '@Utils/convertLayerUtils';
import prepareFormData from '@Utils/prepareFormData';

/**
 * This function looks up the provided map of components to find and return
 * the component associated with the current active step. If no component
 * is found for the given step, it returns an empty fragment.
 *
 * @param {StepComponentMap} componentsMap - An object mapping step numbers to React functional components.
 * @param {number} activeStep - The current active step number.
 * @returns {JSX.Element} - The React component for the active step, or an empty fragment if not found.
 */
const getActiveStepDescription = (
  componentsMap: StepComponentMap,
  activeStep: number,
): JSX.Element => {
  const Component = componentsMap[activeStep];
  return Component ? <Component /> : <></>;
};

const getActiveStepForm = (activeStep: number, formProps: any) => {
  switch (activeStep) {
    case 1:
      return <BasicInformationForm formProps={formProps} />;
    case 2:
      return <DefineAOIForm formProps={formProps} />;
    case 3:
      return <KeyParametersForm formProps={formProps} />;
    case 4:
      return <GenerateTaskForm formProps={formProps} />;
    case 5:
      return <ContributionsForm formProps={formProps} />;
    default:
      return <></>;
  }
};

export default function CreateprojectLayout() {
  const dispatch = useTypedDispatch();
  const navigate = useNavigate();
  const activeStep = useTypedSelector(state => state.createproject.activeStep);
  const splitGeojson = useTypedSelector(
    state => state.createproject.splitGeojson,
  );

  const initialState = {
    name: '',
    description: '',
    outline_geojson: null,
    noflyzone_geojson: null,
    gsd: null,
    final_output_type: null,
    is_terrain_follow: '',
    task_split_type: 1,
    per_task_instructions: '',
    publish: '',
    submission: '',
  };

  const { mutate: uploadTaskBoundary } = useMutation<any, any, any, unknown>({
    mutationFn: postTaskBoundary,
    onSuccess: () => {
      toast.success('Project Boundary Uploaded');
      navigate('/projects');
    },
    onError: err => {
      toast.error(err.message);
    },
  });

  const { mutate: createProject } = useMutation<any, any, any, unknown>({
    mutationFn: postCreateProject,
    onSuccess: (res: any) => {
      toast.success('Project Created Successfully');
      dispatch(setCreateProjectState({ projectId: res.data.id }));
      if (!splitGeojson) return;
      const geojson = convertGeojsonToFile(splitGeojson);
      const formData = prepareFormData({ task_geojson: geojson });
      uploadTaskBoundary({ id: res.data.id, data: formData });
    },
    onError: err => {
      toast.error(err.message);
    },
  });

  const { register, setValue, handleSubmit, reset, formState, trigger } =
    useForm({
      defaultValues: initialState,
    });

  const formProps = {
    register,
    setValue,
    formState,
    trigger,
  };

  const onPrevBtnClick = () => {
    dispatch(setCreateProjectState({ activeStep: activeStep - 1 }));
  };

  const onSubmit = (data: any) => {
    if (activeStep !== 5) {
      dispatch(setCreateProjectState({ activeStep: activeStep + 1 }));
      return;
    }
    createProject(data);
    reset();
  };

  return (
    <section className="project-form-layout">
      <div className="naxatw-grid naxatw-grid-cols-4 naxatw-gap-5">
        {/* description */}
        <div className="description naxatw-col-span-1 naxatw-h-[32.625rem] naxatw-animate-fade-up naxatw-bg-white">
          {getActiveStepDescription(stepDescriptionComponents, activeStep)}
        </div>

        {/* form section */}
        <div className="form naxatw-relative naxatw-col-span-3 naxatw-bg-white">
          {getActiveStepForm(activeStep, formProps)}
          <FlexRow className="naxatw-absolute naxatw-bottom-5 naxatw-w-full naxatw-justify-between naxatw-px-10">
            {activeStep !== 1 ? (
              <Button
                onClick={onPrevBtnClick}
                className="!naxatw-text-red"
                leftIcon="chevron_left"
              >
                Previous
              </Button>
            ) : (
              <div />
            )}
            <Button
              onClick={e => {
                e.preventDefault();
                handleSubmit(onSubmit)();
              }}
              type="submit"
              className="!naxatw-bg-red !naxatw-text-white"
              rightIcon="chevron_right"
            >
              {activeStep === 5 ? 'Save' : 'Next'}
            </Button>
          </FlexRow>
        </div>
      </div>
    </section>
  );
}
