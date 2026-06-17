import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTypedDispatch, useTypedSelector } from "@Store/hooks";
import { FlexRow } from "@Components/common/Layouts";
import Switch from "@Components/RadixComponents/Switch";
import { setCommonState } from "@Store/actions/common";
import { Button } from "@Components/RadixComponents/Button";
import { Select } from "@Components/common/FormUI";
import { setCreateProjectState } from "@Store/actions/createproject";
import SearchInput from "@Components/common/FormUI/SearchInput";
import useDebounceListener from "@Hooks/useDebouncedListener";
import useAuth from "@Hooks/useAuth";
import { m } from "@/paraglide/messages";

export default function ProjectsHeader() {
  const dispatch = useTypedDispatch();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const signedInAs = localStorage.getItem("signedInAs") || "PROJECT_CREATOR";
  const showMap = useTypedSelector((state) => state.common.showMap);
  const projectsFilterByOwner = useTypedSelector(
    (state) => state.createproject.ProjectsFilterByOwner,
  );
  const selectedProjectStatus = useTypedSelector(
    (state) => state.createproject.selectedProjectStatus,
  );
  const [searchValue, setSearchValue] = useState("");
  const debouncedValue = useDebounceListener(searchValue || "", 300);

  useEffect(() => {
    dispatch(setCommonState({ projectSearchKey: debouncedValue as string }));
  }, [debouncedValue, dispatch]);

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-justify-between naxatw-gap-2 naxatw-py-3 lg:naxatw-flex-row">
      <FlexRow className="naxatw-flex naxatw-w-full naxatw-flex-wrap naxatw-items-center naxatw-justify-between naxatw-gap-3 md:naxatw-flex-nowrap md:naxatw-gap-4 lg:naxatw-w-[70%]">
        <h5 className="naxatw-font-bold">{m.projects_heading()}</h5>
        <FlexRow
          gap={3}
          className="naxatw-w-full naxatw-flex-wrap naxatw-items-center naxatw-justify-end md:naxatw-w-auto md:naxatw-flex-nowrap"
        >
          <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
            <Select
              placeholder={m.projects_select_placeholder()}
              options={[
                {
                  label: m.projects_filter_all_projects(),
                  value: "no",
                },
                { label: m.projects_filter_my_projects(), value: "yes" },
              ]}
              labelKey="label"
              valueKey="value"
              className="naxatw-pr-6"
              selectedOption={projectsFilterByOwner}
              onChange={(value) =>
                dispatch(setCreateProjectState({ ProjectsFilterByOwner: value }))
              }
            />
            <Select
              placeholder={m.projects_filter_by_status_placeholder()}
              options={[
                { label: m.projects_status_all_projects(), value: "" },
                {
                  label: m.projects_status_not_started(),
                  value: "not-started",
                },
                { label: m.projects_status_ongoing(), value: "ongoing" },
                { label: m.projects_status_completed(), value: "completed" },
              ]}
              labelKey="label"
              valueKey="value"
              className="naxatw-pr-6"
              selectedOption={selectedProjectStatus}
              onChange={(value) =>
                dispatch(setCreateProjectState({ selectedProjectStatus: value }))
              }
            />
          </div>
          <div className="naxatw-min-w-[180px] naxatw-flex-1 md:naxatw-flex-none">
            <SearchInput
              inputValue={searchValue}
              placeholder={m.projects_search_placeholder()}
              onChange={(e: any) => setSearchValue(e.target.value)}
              onClear={() => setSearchValue("")}
            />
          </div>
        </FlexRow>
      </FlexRow>
      <FlexRow
        gap={4}
        className="naxatw-w-full naxatw-items-center naxatw-justify-end lg:naxatw-w-[220px]"
      >
        <FlexRow className="naxatw-items-center naxatw-gap-[10px]">
          <p className="naxatw-text-body-md">{m.projects_show_map()}</p>
          <Switch
            checked={showMap}
            onClick={() => {
              dispatch(setCommonState({ showMap: !showMap }));
            }}
          />
        </FlexRow>

        {isAuthenticated() && signedInAs === "PROJECT_CREATOR" && (
          <Button
            variant="secondary"
            className="!naxatw-bg-red naxatw-text-white"
            onClick={() => navigate("/create-project")}
          >
            {m.projects_add_project()}
          </Button>
        )}
      </FlexRow>
    </div>
  );
}
