import { FlexColumn } from "@Components/common/Layouts";
import { m } from "@/paraglide/messages";

export default function UseCase() {
  return (
    <FlexColumn gap={2} className="naxatw-animate-fade-up">
      <div>
        <p className="naxatw-text-body-btn">{m.create_step_use_case()}</p>
        <p className="naxatw-text-body-md">{m.create_use_case_description()}</p>
      </div>
    </FlexColumn>
  );
}
