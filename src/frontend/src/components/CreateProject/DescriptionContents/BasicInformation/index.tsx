import { FlexColumn } from "@Components/common/Layouts";
import { m } from "@/paraglide/messages";

export default function BasicInformation() {
  return (
    <FlexColumn gap={2} className="naxatw-animate-fade-up">
      <div className="">
        <p className="naxatw-text-body-btn">{m.create_step_basic_info()}</p>
        <p className="naxatw-text-body-md">{m.create_basic_info_description()}</p>
      </div>
    </FlexColumn>
  );
}
