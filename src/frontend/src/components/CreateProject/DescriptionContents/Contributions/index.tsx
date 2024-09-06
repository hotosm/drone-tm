import { contributionsInfo } from '@Constants/createProject';

export default function Contributions() {
  return contributionsInfo?.map(info => (
    <div className="naxatw-px-10 naxatw-py-5" key={info.key}>
      <p className="naxatw-text-body-btn">{info.key}</p>
      <p className="naxatw-mt-2 naxatw-text-body-md">{info.description}</p>
    </div>
  ));
}
