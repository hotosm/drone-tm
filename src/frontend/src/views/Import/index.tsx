import { useState } from "react";
import { toast } from "react-toastify";

import { Button } from "@Components/RadixComponents/Button";
import { FormControl, Input, Label } from "@Components/common/FormUI";
import { createProjectFromImageryExif } from "@Services/classification";
import hasErrorBoundary from "@Utils/hasErrorBoundary";
import { m } from "@/paraglide/messages";

const Import = () => {
  const [endpoint, setEndpoint] = useState("s3.amazonaws.com");
  const [bucketName, setBucketName] = useState("");
  const [path, setPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!endpoint || !bucketName || !projectName) {
      toast.error(m.import_required_fields_error());
      return;
    }
    setSubmitting(true);
    try {
      await createProjectFromImageryExif({
        endpoint,
        bucket_name: bucketName,
        path,
        project_name: projectName,
      });
      setSubmitted(true);
      toast.success(m.import_job_submitted_success());
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || m.import_request_failed();
      toast.error(detail);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="naxatw-flex naxatw-min-h-screen-nav naxatw-flex-col naxatw-items-center naxatw-px-4 naxatw-py-8 md:naxatw-px-16">
      <div className="naxatw-w-full naxatw-max-w-2xl naxatw-rounded-md naxatw-bg-white naxatw-p-6 naxatw-shadow-md">
        <h4 className="naxatw-mb-2 naxatw-font-bold">{m.import_heading()}</h4>
        <p className="naxatw-mb-6 naxatw-text-body-md naxatw-text-grey-600">
          {m.import_description()}
        </p>

        <form onSubmit={handleSubmit} className="naxatw-flex naxatw-flex-col naxatw-gap-4">
          <FormControl>
            <Label>{m.import_project_name_label()}</Label>
            <Input
              placeholder={m.import_project_name_placeholder()}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              disabled={submitting}
              required
            />
          </FormControl>

          <FormControl>
            <Label>{m.import_s3_endpoint_label()}</Label>
            <Input
              placeholder={m.import_s3_endpoint_placeholder()}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              disabled={submitting}
              required
            />
          </FormControl>

          <FormControl>
            <Label>{m.import_bucket_name_label()}</Label>
            <Input
              placeholder={m.import_bucket_name_placeholder()}
              value={bucketName}
              onChange={(e) => setBucketName(e.target.value)}
              disabled={submitting}
              required
            />
          </FormControl>

          <FormControl>
            <Label>{m.import_path_label()}</Label>
            <Input
              placeholder={m.import_path_placeholder()}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              disabled={submitting}
            />
          </FormControl>

          <Button
            className="naxatw-bg-red naxatw-mt-2 naxatw-self-end"
            type="submit"
            disabled={submitting || !endpoint || !bucketName || !projectName}
            withLoader
            isLoading={submitting}
          >
            {m.import_create_project()}
          </Button>
        </form>

        {submitted && (
          <div className="naxatw-mt-6 naxatw-rounded-md naxatw-border naxatw-border-grey-200 naxatw-bg-grey-50 naxatw-p-4 naxatw-text-body-md">
            {m.import_submitted_message()}
          </div>
        )}
      </div>
    </section>
  );
};

export default hasErrorBoundary(Import);
