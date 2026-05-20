/* eslint-disable camelcase */
import { useTypedDispatch, useTypedSelector } from "@Store/hooks";
import { FormControl, Label, Input } from "@Components/common/FormUI";
import ErrorMessage from "@Components/common/FormUI/ErrorMessage";
import { UseFormPropsType } from "@Components/common/FormUI/types";
import { setCreateProjectState, setDemType } from "@Store/actions/createproject";
import hasErrorBoundary from "@Utils/hasErrorBoundary";
import { useQuery } from "@tanstack/react-query";
import { getDroneAltitude } from "@Services/createproject";
// import { terrainOptions } from '@Constants/createProject';
import { FlexRow } from "@Components/common/Layouts";
import Switch from "@Components/RadixComponents/Switch";
import FileUpload from "@Components/common/UploadArea";
import {
  demFileOptions,
  FinalOutputOptions,
  imageMergeTypeOptions,
  measurementTypeOptions,
} from "@Constants/createProject";
import InfoMessage from "@Components/common/FormUI/InfoMessage";
import {
  altitudeToGsd,
  getForwardSpacing,
  getFrontOverlap,
  getSideOverlap,
  getSideSpacing,
  gsdToAltitude,
} from "@Utils/index";
import SwitchTab from "@Components/common/SwitchTab";
import { Controller } from "react-hook-form";
import RadioButton from "@Components/common/RadioButton";
import { m } from "@/paraglide/messages";

import OutputOptions from "./OutputOptions";

const KeyParameters = ({ formProps }: { formProps: UseFormPropsType }) => {
  const dispatch = useTypedDispatch();

  const { register, errors, watch, control, setValue } = formProps;
  const final_output = watch("final_output");
  const gsdInputValue = watch("gsd_cm_px");
  const altitudeInputValue = watch("altitude_from_ground");
  const frontOverlapInputValue = watch("front_overlap");
  const sideOverlapInputValue = watch("side_overlap");
  const forwardSpacingInputValue = watch("forward_spacing");
  const sideSpacingInputValue = watch("side_spacing");

  const keyParamOption = useTypedSelector((state) => state.createproject.keyParamOption);
  const measurementType = useTypedSelector((state) => state.createproject.measurementType);
  const isTerrainFollow = useTypedSelector((state) => state.createproject.isTerrainFollow);
  const imageMergeType = useTypedSelector((state) => state.createproject.imageMergeType);
  const projectCountry = useTypedSelector((state) => state.common.projectCountry);
  const demType = useTypedSelector((state) => state.createproject.demType);

  const { data: droneAltitude } = useQuery({
    queryKey: ["drone-altitude", projectCountry],
    queryFn: () => getDroneAltitude(projectCountry || ""),
    select: (data) => data.data,
    enabled: !!projectCountry,
  });

  // get altitude
  const agl = measurementType === "gsd" ? gsdToAltitude(gsdInputValue) : altitudeInputValue;

  // Terrain/elevation outputs (DTM index 1, DSM index 2) need higher overlap for triangulation
  const isTerrainOutput = final_output?.[1] || final_output?.[2];
  const frontOverlapRecommendation = isTerrainOutput ? "85%" : "75%";
  const sideOverlapRecommendation = isTerrainOutput ? "85%" : "65%";

  return (
    <div className="naxatw-h-fit">
      {/* <RadioButton
        options={KeyParametersOptions}
        direction="row"
        onChangeData={val => {
          dispatch(setCreateProjectState({ keyParamOption: val }));
        }}
        value={keyParamOption}
      /> */}
      {keyParamOption === "basic" ? (
        <>
          <FormControl>
            <Label>{m.create_params_measurement_label()}</Label>
            <SwitchTab
              options={measurementTypeOptions()}
              valueKey="value"
              selectedValue={measurementType}
              activeClassName="naxatw-bg-red naxatw-text-white"
              onChange={(selected: any) => {
                setValue("gsd_cm_px", "");
                setValue("altitude_from_ground", "");
                dispatch(setCreateProjectState({ measurementType: selected.value }));
              }}
            />
          </FormControl>

          {measurementType === "gsd" ? (
            <FormControl className="naxatw-mt-2 naxatw-gap-1">
              <Label required>{m.create_params_gsd_label()}</Label>
              <Input
                placeholder={m.create_params_gsd_placeholder()}
                type="number"
                max={10}
                min={0}
                {...register("gsd_cm_px", {
                  required: m.create_params_gsd_required(),
                  valueAsNumber: true,
                  max: {
                    value: 10,
                    message: m.create_params_gsd_too_high(),
                  },
                  min: {
                    value: 0,
                    message: m.create_params_gsd_negative(),
                  },
                })}
              />
              {gsdInputValue ? (
                <InfoMessage
                  message={m.create_params_gsd_equivalent_altitude({
                    altitude: gsdToAltitude(Number(gsdInputValue))
                      ?.toFixed(2)
                      ?.replace(/\.00$/, ""),
                  })}
                />
              ) : (
                <></>
              )}
              {errors?.gsd_cm_px?.message && (
                <ErrorMessage message={errors?.gsd_cm_px?.message as string} />
              )}
            </FormControl>
          ) : (
            <FormControl className="naxatw-mt-4 naxatw-gap-1">
              <Label required>{m.create_params_altitude_label()}</Label>
              <Input
                placeholder={m.create_params_altitude_placeholder()}
                type="number"
                max={300}
                min={0}
                {...register("altitude_from_ground", {
                  required: m.create_params_altitude_required(),
                  valueAsNumber: true,
                  max: {
                    value: 300,
                    message: m.create_params_altitude_too_high(),
                  },
                  min: {
                    value: 0,
                    message: m.create_params_altitude_negative(),
                  },
                })}
              />
              {altitudeInputValue ? (
                <InfoMessage
                  message={m.create_params_altitude_equivalent_gsd({
                    gsd: altitudeToGsd(Number(altitudeInputValue))
                      ?.toFixed(2)
                      ?.replace(/\.00$/, ""),
                  })}
                />
              ) : (
                <></>
              )}

              {errors?.altitude_from_ground?.message && (
                <ErrorMessage message={errors?.altitude_from_ground?.message as string} />
              )}
            </FormControl>
          )}

          {droneAltitude?.country &&
            droneAltitude?.max_altitude_ft &&
            (altitudeInputValue > droneAltitude?.max_altitude_m ||
              gsdToAltitude(Number(gsdInputValue)) > droneAltitude?.max_altitude_m) && (
              <InfoMessage
                className="naxatw-text-[#FFA500]"
                message={m.create_params_country_max_altitude({
                  country: droneAltitude?.country,
                  altitude: droneAltitude?.max_altitude_m,
                })}
              />
            )}

          <FormControl className="naxatw-mt-5">
            <Label>{m.create_params_merge_type_label()}</Label>

            <SwitchTab
              options={imageMergeTypeOptions()}
              valueKey="value"
              selectedValue={imageMergeType}
              activeClassName="naxatw-bg-red naxatw-text-white"
              onChange={(selected: any) => {
                setValue("front_overlap", "");
                setValue("side_overlap", "");
                setValue("forward_spacing", "");
                setValue("side_spacing", "");
                dispatch(setCreateProjectState({ imageMergeType: selected.value }));
              }}
            />
          </FormControl>
          {imageMergeType === "overlap" ? (
            <>
              <FlexRow className="naxatw-grid naxatw-grid-cols-2 naxatw-gap-3">
                <FormControl className="naxatw-mt-2 naxatw-gap-1">
                  <Label required>{m.create_params_front_overlap_label()}</Label>
                  <Input
                    placeholder={m.create_params_front_overlap_placeholder()}
                    type="number"
                    max={100}
                    min={0}
                    {...register("front_overlap", {
                      required: m.create_params_front_overlap_required(),
                      valueAsNumber: true,
                      max: {
                        value: 100,
                        message: m.create_params_front_overlap_too_high(),
                      },
                      min: {
                        value: 0,
                        message: m.create_params_front_overlap_negative(),
                      },
                    })}
                  />
                  {frontOverlapInputValue && agl ? (
                    <InfoMessage
                      message={m.create_params_front_overlap_equivalent_spacing({
                        spacing: getForwardSpacing(agl, frontOverlapInputValue)?.replace(
                          /\.00$/,
                          "",
                        ),
                      })}
                    />
                  ) : (
                    <></>
                  )}
                  <ErrorMessage message={errors?.forward_overlap_percent?.message as string} />
                  <p className="naxatw-text-[#68707F]">
                    {m.create_params_recommended({
                      value: frontOverlapRecommendation,
                    })}
                  </p>
                </FormControl>
                <FormControl className="naxatw-mt-2 naxatw-gap-1">
                  <Label required>{m.create_params_side_overlap_label()}</Label>
                  <Input
                    placeholder={m.create_params_front_overlap_placeholder()}
                    type="number"
                    max={100}
                    min={0}
                    {...register("side_overlap", {
                      required: m.create_params_side_overlap_required(),
                      valueAsNumber: true,
                      max: {
                        value: 100,
                        message: m.create_params_side_overlap_too_high(),
                      },
                      min: {
                        value: 0,
                        message: m.create_params_side_overlap_negative(),
                      },
                    })}
                  />
                  {sideOverlapInputValue && agl ? (
                    <InfoMessage
                      message={m.create_params_side_overlap_equivalent_spacing({
                        spacing: getSideSpacing(agl, sideOverlapInputValue)?.replace(/\.00$/, ""),
                      })}
                    />
                  ) : (
                    <></>
                  )}
                  <ErrorMessage message={errors?.side_overlap_percent?.message as string} />
                  <p className="naxatw-text-[#68707F]">
                    {m.create_params_recommended({
                      value: sideOverlapRecommendation,
                    })}
                  </p>
                </FormControl>
              </FlexRow>
              <div className="naxatw-mt-3 naxatw-rounded-md naxatw-border naxatw-border-[#17A2B8] naxatw-bg-[#e6f7fb] naxatw-p-3">
                <p className="naxatw-mb-1 naxatw-text-sm naxatw-font-semibold naxatw-text-[#17A2B8]">
                  {m.create_params_overlap_guidance_title()}
                </p>
                <ul className="naxatw-ml-4 naxatw-list-disc naxatw-space-y-1 naxatw-text-sm naxatw-text-[#4A5568]">
                  {isTerrainOutput ? (
                    <li>
                      Terrain and elevation models need <strong>85% or higher on both axes</strong>{" "}
                      for accurate triangulation. Side overlap below 70% is not recommended.
                    </li>
                  ) : (
                    <li>For orthophotos, 75% front and 65% side is a reliable minimum.</li>
                  )}
                  <li>
                    Low-texture areas (sand, water, bare ground, dense vegetation) and mountainous
                    terrain benefit from higher overlaps to ensure sufficient matching points
                    between images.
                  </li>
                  <li>Never go below 72% front overlap as a practical floor.</li>
                </ul>
              </div>
            </>
          ) : (
            <FlexRow className="naxatw-grid naxatw-grid-cols-2 naxatw-gap-3">
              <FormControl className="naxatw-mt-4 naxatw-gap-1">
                <Label required>{m.create_params_forward_spacing_label()}</Label>
                <Input
                  placeholder={m.create_params_forward_spacing_placeholder()}
                  type="number"
                  max={100}
                  min={0}
                  {...register("forward_spacing", {
                    required: m.create_params_forward_spacing_required(),
                    valueAsNumber: true,
                    max: {
                      value: 100,
                      message: m.create_params_forward_spacing_too_high(),
                    },
                    min: {
                      value: 0,
                      message: m.create_params_forward_spacing_negative(),
                    },
                  })}
                />
                {forwardSpacingInputValue && agl ? (
                  <InfoMessage
                    message={m.create_params_forward_spacing_equivalent_overlap({
                      overlap: getFrontOverlap(agl, forwardSpacingInputValue)?.replace(/\.00$/, ""),
                    })}
                  />
                ) : (
                  <></>
                )}
                <ErrorMessage message={errors?.forward_spacing?.message as string} />
              </FormControl>
              <FormControl className="naxatw-mt-4 naxatw-gap-1">
                <Label required>{m.create_params_side_spacing_label()}</Label>
                <Input
                  placeholder={m.create_params_forward_spacing_placeholder()}
                  type="number"
                  max={100}
                  min={0}
                  {...register("side_spacing", {
                    required: m.create_params_side_spacing_required(),
                    valueAsNumber: true,
                    max: {
                      value: 100,
                      message: m.create_params_side_spacing_too_high(),
                    },
                    min: {
                      value: 0,
                      message: m.create_params_side_spacing_negative(),
                    },
                  })}
                />
                {sideSpacingInputValue && agl ? (
                  <InfoMessage
                    message={m.create_params_side_spacing_equivalent_overlap({
                      overlap: getSideOverlap(agl, sideSpacingInputValue)?.replace(/\.00$/, ""),
                    })}
                  />
                ) : (
                  <></>
                )}
                <ErrorMessage message={errors?.side_spacing?.message as string} />
              </FormControl>
            </FlexRow>
          )}
          <FormControl className="naxatw-mt-4 naxatw-gap-1">
            <Label>{m.create_params_final_output_label()}</Label>
            <div className="naxatw-col-span-1 naxatw-my-4 naxatw-grid naxatw-gap-3 sm:naxatw-grid-cols-2 md:naxatw-grid-cols-4">
              {FinalOutputOptions().map((option, index) => (
                <OutputOptions
                  key={option.label}
                  icon={option.icon}
                  name={`final_output.${index}`}
                  checked={final_output?.[index]}
                  label={option.label}
                  value={option.value}
                  register={register}
                />
              ))}
            </div>
          </FormControl>

          <FormControl className="naxatw-mt-4">
            <FlexRow className="naxatw-mb-4 naxatw-items-center naxatw-gap-[10px]">
              <p className="naxatw-text-body-md">{m.create_params_follow_terrain()}</p>
              <Switch
                checked={isTerrainFollow}
                onClick={() => {
                  dispatch(
                    setCreateProjectState({
                      isTerrainFollow: !isTerrainFollow,
                    }),
                  );
                }}
              />
            </FlexRow>
          </FormControl>
          {isTerrainFollow && (
            <FormControl className="naxatw-mt-2">
              <RadioButton
                required
                options={demFileOptions()}
                direction="column"
                onChangeData={(value) => {
                  dispatch(setDemType(value));
                }}
                value={demType}
                // name="requireApprovalFromManagerForLocking"
              />
              <ErrorMessage message={errors?.dem?.message as string} />
            </FormControl>
          )}

          {demType === "manual" && isTerrainFollow && (
            <FormControl className="naxatw-mt-2">
              <Controller
                control={control}
                name="dem"
                rules={{
                  required: m.create_params_dem_required(),
                }}
                render={({ field: { value } }) => {
                  return (
                    <FileUpload
                      name="dem"
                      data={value}
                      fileAccept=".tif, .tiff"
                      placeholder={m.create_params_dem_upload_placeholder()}
                      {...formProps}
                    />
                  );
                }}
              />
              <ErrorMessage message={errors?.dem?.message as string} />
            </FormControl>
          )}
        </>
      ) : (
        <>
          <FormControl className="naxatw-mt-4 naxatw-gap-1">
            <Label>{m.create_params_advanced_altitude_label()}</Label>
            <Input placeholder={m.create_params_advanced_altitude_placeholder()} />
          </FormControl>
          <FormControl className="naxatw-mt-4 naxatw-gap-1">
            <Label>{m.create_params_advanced_gimbal_label()}</Label>
            <Input placeholder={m.create_params_advanced_gimbal_placeholder()} />
          </FormControl>
          <FormControl className="naxatw-mt-4 naxatw-gap-1">
            <Label>{m.create_params_advanced_distance_label()}</Label>
            <Input placeholder={m.create_params_advanced_distance_placeholder()} />
          </FormControl>
          <FormControl className="naxatw-mt-4 naxatw-gap-1">
            <Label>{m.create_params_advanced_overlap_label()}</Label>
            <Input placeholder={m.create_params_advanced_overlap_placeholder()} />
          </FormControl>
          <FormControl className="naxatw-mt-4 naxatw-gap-1">
            <Label>{m.create_params_advanced_line_orientation_label()}</Label>
            <Input placeholder={m.create_params_advanced_line_orientation_placeholder()} />
          </FormControl>
        </>
      )}
    </div>
  );
};

export default hasErrorBoundary(KeyParameters);
