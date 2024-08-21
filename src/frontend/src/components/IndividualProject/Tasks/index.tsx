// import SearchInput from '@Components/common/FormUI/SearchInput';
// import { Select } from '@Components/common/FormUI';
// import { FlexRow } from '@Components/common/Layouts';
import TableSection from './TableSection';

export default function Tasks() {
  return (
    <section className="naxatw-py-5">
      {/* <FlexRow className="naxatw-w-full naxatw-justify-between">
        <div className="naxatw-w-1/2">
          <SearchInput
            className="naxatw-rounded-md !naxatw-border naxatw-border-grey-200"
            inputValue=""
            placeholder="Filter by ID"
            onChange={() => {}}
          />
        </div>
        <div className="naxatw-w-1/3">
          <Select
            placeholder="Label"
            options={[]}
            className="naxatw-border-grey-200"
          />
        </div>
      </FlexRow> */}
      <div className="naxatw-mt-2">
        <TableSection />
      </div>
    </section>
  );
}
