import TableSection from './TableSection';

interface IContributionsProps {
  isFetching: boolean;
  // eslint-disable-next-line no-unused-vars
  handleTableRowClick: (taskId: string) => {};
}

export default function Contributions({
  isFetching,
  handleTableRowClick,
}: IContributionsProps) {
  return (
    <section className="naxatw-py-5">
      <div className="mt-2">
        <TableSection
          isFetching={isFetching}
          handleTableRowClick={handleTableRowClick}
        />
      </div>
    </section>
  );
}
