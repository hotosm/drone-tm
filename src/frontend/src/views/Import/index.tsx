import { useState } from "react";
import { toast } from "react-toastify";

import { Button } from "@Components/RadixComponents/Button";
import { FormControl, Input, Label } from "@Components/common/FormUI";
import { createProjectFromImageryExif } from "@Services/classification";
import hasErrorBoundary from "@Utils/hasErrorBoundary";

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
      toast.error("Endpoint, bucket name, and project name are required");
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
      toast.success("Project creation job submitted");
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || "Request failed";
      toast.error(detail);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="naxatw-flex naxatw-min-h-screen-nav naxatw-flex-col naxatw-items-center naxatw-px-4 naxatw-py-8 md:naxatw-px-16">
      <div className="naxatw-w-full naxatw-max-w-2xl naxatw-rounded-md naxatw-bg-white naxatw-p-6 naxatw-shadow-md">
        <h4 className="naxatw-mb-2 naxatw-font-bold">Import imagery from S3</h4>
        <p className="naxatw-mb-6 naxatw-text-body-md naxatw-text-grey-600">
          Point at a public S3-compatible bucket. We&apos;ll scan EXIF GPS from each JPEG
          (subdirectories up to 3 levels deep), build a buffered AOI, and create a drone-tm project.
          Imagery transfer and ingestion are run separately afterwards.
        </p>

        <form onSubmit={handleSubmit} className="naxatw-flex naxatw-flex-col naxatw-gap-4">
          <FormControl>
            <Label>Project name</Label>
            <Input
              placeholder="My drone survey"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              disabled={submitting}
              required
            />
          </FormControl>

          <FormControl>
            <Label>S3 endpoint</Label>
            <Input
              placeholder="s3.amazonaws.com"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              disabled={submitting}
              required
            />
          </FormControl>

          <FormControl>
            <Label>Bucket name</Label>
            <Input
              placeholder="my-bucket"
              value={bucketName}
              onChange={(e) => setBucketName(e.target.value)}
              disabled={submitting}
              required
            />
          </FormControl>

          <FormControl>
            <Label>Path / prefix (optional)</Label>
            <Input
              placeholder="surveys/2025-01/site-a"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              disabled={submitting}
            />
          </FormControl>

          <Button
            type="submit"
            disabled={submitting}
            withLoader
            isLoading={submitting}
            className="naxatw-mt-2 naxatw-self-end"
          >
            Create project
          </Button>
        </form>

        {submitted && (
          <div className="naxatw-mt-6 naxatw-rounded-md naxatw-border naxatw-border-grey-200 naxatw-bg-grey-50 naxatw-p-4 naxatw-text-body-md">
            Please be patient while the project is created in the background. For many images, this
            may take several hours. The new project will appear on your projects list once it has
            been created.
          </div>
        )}
      </div>
    </section>
  );
};

export default hasErrorBoundary(Import);
