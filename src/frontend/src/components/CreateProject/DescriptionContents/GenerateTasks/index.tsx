import { FlexColumn } from "@Components/common/Layouts";
import { taskGenerationGuidelines } from "@Constants/createProject";
import { m } from "@/paraglide/messages";

export default function GenerateTasks() {
  const guidelines = taskGenerationGuidelines();
  return (
    <FlexColumn gap={2} className="naxatw-animate-fade-up">
      <div>
        <p className="naxatw-text-body-btn">{m.create_generate_title()}</p>
        <p className="naxatw-text-body-md">{m.create_generate_description()}</p>
      </div>
      <div>
        <p className="naxatw-text-body-md">{guidelines.title}</p>
        <ol className="naxatw-flex naxatw-list-decimal naxatw-flex-col naxatw-gap-1 naxatw-px-2 naxatw-py-2">
          {guidelines.guidelines.map((item) => (
            <li key={item} className="naxatw-text-left naxatw-text-body-md">
              {item}
            </li>
          ))}
        </ol>
      </div>
    </FlexColumn>
  );
}
