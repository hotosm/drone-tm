import { useParams } from 'react-router-dom';

export default function IndividualProject() {
  const { id } = useParams();
  return (
    <section>
      <h4>This is {id} project section</h4>
    </section>
  );
}
