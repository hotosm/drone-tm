import { useTypedDispatch, useTypedSelector } from "@Store/hooks";
import { setCreateProjectState } from "@Store/actions/createproject";
import { useCaseOptions } from "@Constants/createProject";
import hasErrorBoundary from "@Utils/hasErrorBoundary";
import Icon from "@Components/common/Icon";
import { m } from "@/paraglide/messages";
import type { UseCase as UseCaseValue } from "@Store/slices/createproject";

const UseCase = () => {
  const dispatch = useTypedDispatch();
  const useCase = useTypedSelector((state) => state.createproject.useCase);

  return (
    <div className="naxatw-flex naxatw-h-full naxatw-w-full naxatw-flex-col naxatw-items-center naxatw-justify-center naxatw-py-6">
      <div className="naxatw-mb-8 naxatw-max-w-2xl naxatw-text-center">
        <h4 className="naxatw-text-body-btn naxatw-text-xl">{m.create_use_case_title()}</h4>
        <p className="naxatw-mt-2 naxatw-text-body-md naxatw-text-[#555]">
          {m.create_use_case_description()}
        </p>
      </div>
      <div className="naxatw-grid naxatw-w-full naxatw-max-w-5xl naxatw-grid-cols-1 naxatw-gap-6 md:naxatw-grid-cols-3">
        {useCaseOptions().map((option) => {
          const isSelected = option.value === useCase;
          return (
            <label
              key={option.value}
              className={`naxatw-relative naxatw-flex naxatw-cursor-pointer naxatw-flex-col naxatw-items-center naxatw-rounded-lg naxatw-border-2 naxatw-p-6 naxatw-text-center naxatw-shadow-sm naxatw-transition hover:naxatw-border-red hover:naxatw-shadow-md ${
                isSelected
                  ? "naxatw-border-red naxatw-bg-redlight"
                  : "naxatw-border-[#D7D7D7] naxatw-bg-white"
              }`}
            >
              <img src={option.icon} alt="" className="naxatw-mb-4 naxatw-h-20 naxatw-w-20" />
              <p className="naxatw-mb-2 naxatw-text-body-btn">{option.label}</p>
              <p className="naxatw-text-body-md naxatw-text-[#555]">{option.description}</p>
              <input
                type="radio"
                name="useCase"
                value={option.value}
                checked={isSelected}
                onChange={() =>
                  dispatch(setCreateProjectState({ useCase: option.value as UseCaseValue }))
                }
                className="naxatw-sr-only"
              />
              {isSelected && (
                <div className="naxatw-absolute naxatw-right-3 naxatw-top-3 naxatw-flex naxatw-h-6 naxatw-w-6 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-bg-red">
                  <Icon name="check" className="!naxatw-text-base naxatw-text-white" />
                </div>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default hasErrorBoundary(UseCase);
