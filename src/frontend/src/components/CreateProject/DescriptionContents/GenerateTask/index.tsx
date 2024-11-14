import { FlexColumn } from '@Components/common/Layouts';
import { taskGenerationGuidelines } from '@Constants/createProject';

export default function GenerateTask() {
  return (
    <FlexColumn gap={2} className="naxatw-animate-fade-up">
      <div>
        <p className="naxatw-text-body-btn">Generate task</p>
        <p className="naxatw-text-body-md">
          Split the task into smaller chunks based on the given dimensions to
          ensure more efficient and precise data collection and analysis.
        </p>
      </div>
      <div>
        <p className="naxatw-text-body-md">{taskGenerationGuidelines?.title}</p>
        <ol className="naxatw-flex naxatw-list-decimal naxatw-flex-col naxatw-gap-1 naxatw-px-2 naxatw-py-2">
          {taskGenerationGuidelines?.guidelines?.map(item => (
            <li key={item} className="naxatw-text-left naxatw-text-body-md">
              {item}
            </li>
          ))}
        </ol>
      </div>
    </FlexColumn>
  );
}
