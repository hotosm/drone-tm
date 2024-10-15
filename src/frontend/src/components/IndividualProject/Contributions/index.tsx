import TableSection from './TableSection';

export default function Contributions({ isFetching }: { isFetching: boolean }) {
  return (
    <section className="naxatw-py-5">
      <div className="mt-2">
        <TableSection isFetching={isFetching} />
      </div>
    </section>
  );
}
