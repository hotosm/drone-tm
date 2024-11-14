import { taskGenerationGuidelines } from '@Constants/createProject';

export default function GenerateTask() {
  return (
    <div className="">
      <p className="naxatw-text-body-btn">Generate task</p>
      <p className="naxatw-mt-2 naxatw-text-body-md">
        Split the task into smaller chunks based on the given dimensions to
        ensure more efficient and precise data collection and analysis.
      </p>
      <br />
      <div>
        <p className="naxatw-mt-2 naxatw-text-body-md">
          {taskGenerationGuidelines?.title}
        </p>
        <ol className="naxatw-flex naxatw-list-decimal naxatw-flex-col naxatw-gap-1 naxatw-px-2 naxatw-py-2">
          {taskGenerationGuidelines?.guidelines?.map(item => (
            <li key={item} className="naxatw-text-left naxatw-text-body-md">
              {item}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
