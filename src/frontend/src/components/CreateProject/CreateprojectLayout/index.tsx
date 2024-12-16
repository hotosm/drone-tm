import { useNavigate } from 'react-router-dom';
import { useTypedSelector, useTypedDispatch } from '@Store/hooks';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FieldValues, useForm } from 'react-hook-form';
import {
  BasicInformationForm,
  DefineAOIForm,
  KeyParametersForm,
  ContributionsForm,
  GenerateTaskForm,
} from '@Components/CreateProject/FormContents';
import { UseFormPropsType } from '@Components/common/FormUI/types';
import { FlexRow } from '@Components/common/Layouts';
import { Button } from '@Components/RadixComponents/Button';
import centroid from '@turf/centroid';
import {
  resetUploadedAndDrawnAreas,
  setCreateProjectState,
} from '@Store/actions/createproject';
import { postCreateProject, postTaskBoundary } from '@Services/createproject';
import { toast } from 'react-toastify';
import {
  StepComponentMap,
  stepDescriptionComponents,
} from '@Constants/createProject';
import { convertGeojsonToFile } from '@Utils/convertLayerUtils';
import prepareFormData from '@Utils/prepareFormData';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import { getFrontOverlap, getSideOverlap, gsdToAltitude } from '@Utils/index';
import { useEffect, useState } from 'react';
import { getCountry } from '@Services/common';
import { setCommonState } from '@Store/actions/common';

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

const getActiveStepForm = (activeStep: number, formProps: UseFormPropsType) => {
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

const CreateprojectLayout = () => {
  const dispatch = useTypedDispatch();
  const navigate = useNavigate();
  const [projectCentroid, setProjectCentroid] = useState<number[] | null>(null);

  const activeStep = useTypedSelector(state => state.createproject.activeStep);
  const splitGeojson = useTypedSelector(
    state => state.createproject.splitGeojson,
  );
  const isTerrainFollow = useTypedSelector(
    state => state.createproject.isTerrainFollow,
  );
  const isNoflyzonePresent = useTypedSelector(
    state => state.createproject.isNoflyzonePresent,
  );
  const requireApprovalFromManagerForLocking = useTypedSelector(
    state => state.createproject.requireApprovalFromManagerForLocking,
  );
  const measurementType = useTypedSelector(
    state => state.createproject.measurementType,
  );
  const projectImage = useTypedSelector(
    state => state.createproject.projectMapImage,
  );
  const capturedProjectMap = useTypedSelector(
    state => state.createproject.capturedProjectMap,
  );
  const imageMergeType = useTypedSelector(
    state => state.createproject.imageMergeType,
  );
  const requiresApprovalFromRegulator = useTypedSelector(
    state => state.createproject.requiresApprovalFromRegulator,
  );
  const regulatorEmails = useTypedSelector(
    state => state.createproject.regulatorEmails,
  );
  const demType = useTypedSelector(state => state.createproject.demType);

  const initialState: FieldValues = {
    name: '',
    // short_description: '',
    description: '',
    outline: null,
    no_fly_zones: null,
    gsd_cm_px: null,
    task_split_dimension: null,
    is_terrain_follow: null,
    // task_split_type: 1,
    per_task_instructions: '',
    deadline_at: '',
    visibility: 0,
    dem: null,
    requires_approval_from_manager_for_locking: false,
    altitude_from_ground: 0,
    requires_approval_from_regulator: false,
    regulator_emails: [],
  };

  const {
    register,
    setValue,
    handleSubmit,
    reset,
    formState: { errors },
    control,
    getValues,
    watch,
  } = useForm({
    defaultValues: initialState,
  });

  const { mutate: uploadTaskBoundary, isLoading } = useMutation<
    any,
    any,
    any,
    unknown
  >({
    mutationFn: postTaskBoundary,
    onSuccess: () => {
      toast.success('Project Created Successfully');
      reset();
      dispatch(
        setCreateProjectState({
          activeStep: 1,
          splitGeojson: null,
          uploadedProjectArea: null,
          uploadedNoFlyZone: null,
        }),
      );
      navigate('/projects');
    },
    onError: err => {
      toast.error(err.message);
    },
  });

  const { mutate: createProject, isLoading: isCreatingProject } = useMutation<
    any,
    any,
    any,
    unknown
  >({
    mutationFn: postCreateProject,
    onSuccess: (res: any) => {
      dispatch(setCreateProjectState({ projectId: res.data.project_id }));
      if (!splitGeojson) return;
      const geojson = convertGeojsonToFile(splitGeojson);
      const formData = prepareFormData({ geojson });
      uploadTaskBoundary({ id: res.data.project_id, data: formData });
      reset();
      dispatch(resetUploadedAndDrawnAreas());
    },
    onError: err => {
      toast.error(err?.response?.data?.detail || err?.message || '');
    },
  });

  const formProps = {
    register,
    setValue,
    reset,
    errors,
    control,
    getValues,
    watch,
  };

  const onPrevBtnClick = () => {
    dispatch(setCreateProjectState({ activeStep: activeStep - 1 }));
  };

  const { isFetching: isFetchingCountry } = useQuery({
    queryFn: () =>
      getCountry({
        lon: projectCentroid?.[0] || 0,
        lat: projectCentroid?.[1] || 0,
        format: 'json',
      }),
    queryKey: ['country', projectCentroid?.[0], projectCentroid?.[1]],
    enabled: !!projectCentroid,
    select(data) {
      dispatch(
        setCommonState({
          projectCountry: data?.data?.address?.country || null,
        }),
      );
    },
  });

  const onSubmit = (data: any) => {
    if (activeStep === 2) {
      if (
        !data?.outline ||
        (Array.isArray(data?.outline) && data?.outline?.length === 0)
      ) {
        toast.error('Please upload or draw and save project area');
        return;
      }
      if (
        isNoflyzonePresent === 'yes' &&
        (!data?.no_fly_zones || data?.no_fly_zones?.length === 0)
      ) {
        toast.error('Please upload or draw and save No Fly zone area');
        return;
      }
      const newCentroid = centroid(data.outline)?.geometry?.coordinates;
      setProjectCentroid(newCentroid);
    }

    if (activeStep === 3) {
      const finalOutput = data?.final_output?.filter(
        (output: string | boolean) => output,
      );
      if (!finalOutput?.length) {
        toast.error('Please select the final output');
        return;
      }
      setValue('final_output', finalOutput);
    }

    if (activeStep === 4 && !splitGeojson) return;

    if (activeStep === 5) {
      if (requiresApprovalFromRegulator === 'required') {
        if (regulatorEmails?.length) {
          setValue('requires_approval_from_regulator', true);
          setValue('regulator_emails', regulatorEmails);
        } else {
          toast.error("Please provide regulator's email");
          return;
        }
      }
    }

    if (activeStep !== 5) {
      dispatch(setCreateProjectState({ activeStep: activeStep + 1 }));
      return;
    }

    // get altitude
    const agl =
      measurementType === 'gsd'
        ? gsdToAltitude(data?.gsd_cm_px)
        : data?.altitude_from_ground;

    const refactoredData = {
      ...data,
      is_terrain_follow: isTerrainFollow,
      requires_approval_from_manager_for_locking:
        requireApprovalFromManagerForLocking === 'required',
      deadline_at: data?.deadline_at ? data?.deadline_at : null,
      front_overlap:
        imageMergeType === 'spacing'
          ? getFrontOverlap(agl, data?.forward_spacing)
          : data?.front_overlap,
      side_overlap:
        imageMergeType === 'spacing'
          ? getSideOverlap(agl, data?.side_spacing)
          : data?.side_overlap,

      requires_approval_from_regulator:
        requiresApprovalFromRegulator === 'required',
      regulator_emails: regulatorEmails,
    };
    delete refactoredData?.forward_spacing;
    delete refactoredData?.side_spacing;

    // remove key
    if (isNoflyzonePresent === 'no')
      delete refactoredData?.outline_no_fly_zones;
    delete refactoredData?.dem;
    if (measurementType === 'gsd') delete refactoredData?.altitude_from_ground;
    else delete refactoredData?.gsd_cm_px;
    if (requiresApprovalFromRegulator !== 'required')
      delete refactoredData?.regulator_emails;

    // make form data with value JSON stringify to combine value on single json / form data with only 2 keys (backend didn't found project_info on non-stringified data)
    const formData = new FormData();
    formData.append('project_info', JSON.stringify({ ...refactoredData }));
    formData.append('image', projectImage.projectMapImage);

    if (isTerrainFollow && demType === 'manual') {
      formData.append('dem', data?.dem?.[0]?.file);
    }
    createProject(formData);
  };

  useEffect(() => {
    return () => {
      reset();
      dispatch(resetUploadedAndDrawnAreas());
      dispatch(
        setCreateProjectState({
          activeStep: 1,
          splitGeojson: null,
          uploadedProjectArea: null,
          uploadedNoFlyZone: null,
          projectCountry: null,
        }),
      );
    };
  }, [reset, dispatch]);

  return (
    <section className="project-form-layout naxatw-h-full naxatw-bg-[#FAFAFA]">
      <div className="naxatw-grid naxatw-h-full naxatw-grid-cols-4 naxatw-gap-5 naxatw-p-2">
        {/* description */}
        <div className="description naxatw-col-span-4 naxatw-min-h-[20vh] naxatw-animate-fade-up naxatw-overflow-y-auto naxatw-bg-white naxatw-px-5 naxatw-py-5 lg:naxatw-col-span-1 lg:naxatw-h-[calc(100vh-225px)]">
          {getActiveStepDescription(stepDescriptionComponents, activeStep)}
        </div>

        {/* form section */}
        <div className="form naxatw-relative naxatw-col-span-4 naxatw-h-full naxatw-bg-white naxatw-pb-[60px] lg:naxatw-col-span-3">
          <div className="naxatw-h-full naxatw-w-full naxatw-overflow-y-auto naxatw-px-5 naxatw-py-5 lg:naxatw-h-[calc(100vh-285px)]">
            {getActiveStepForm(activeStep, formProps)}
          </div>
          <FlexRow className="naxatw-absolute naxatw-bottom-5 naxatw-h-9 naxatw-w-full naxatw-justify-between naxatw-px-8">
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
              withLoader
              isLoading={
                isLoading ||
                isCreatingProject ||
                !capturedProjectMap ||
                isFetchingCountry
              }
              disabled={isLoading || isCreatingProject || !capturedProjectMap}
            >
              {activeStep === 5 ? 'Save' : 'Next'}
            </Button>
          </FlexRow>
        </div>
      </div>
    </section>
  );
};

export default hasErrorBoundary(CreateprojectLayout);
