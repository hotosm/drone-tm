import Skeleton from '@Components/RadixComponents/Skeleton';

export default function Instructions({
  projectData,
  isProjectDataLoading,
}: {
  projectData: Record<string, any>;
  isProjectDataLoading: boolean;
}) {
  return (
    <section className="instructions naxatw-py-5">
      {isProjectDataLoading ? (
        <Skeleton className="naxatw-h-full naxatw-w-full" />
      ) : (
        <p className="naxatw-animate-fade-up naxatw-text-body-sm">
          {projectData?.per_task_instructions}
        </p>
      )}
    </section>
  );
}
