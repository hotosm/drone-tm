# Data storage and processing in AWS

# Use FastAPI as Python web API framework

## Context and Problem Statement

We need to store:

- Uploaded user imagery (raw drone images).
- Final imagery products after processing (orthos, point clouds, 3D products).

This takes up a lot of space over time, with raw images
being ~5–15MB each and projects commonly reaching
hundreds of GB or more.

We need to process:

- Imagery --> point cloud, orthomosaic, 3D products.

This requires significant compute and memory, with large
projects potentially taking many hours or days to process.

In addition, we need to support:

- Fast uploads to improve user experience.
- Cost-effective downloads for UI display and sharing.
- Long-term archiving of old projects at low cost.

Note: historically, we have benefited from free AWS credits
as an NGO working on humanitarian use cases, but the system
should remain cost-efficient even without credits.

## Considered Options

- On-prem compute + on-prem MinIO instance (S3-compatible storage).
- On-prem compute + Cloudflare R2 storage.
- AWS compute + S3 storage (with CloudFront for delivery).

The key factors at play here are:

- Actual cost of services (compute, storage, requests).
- The cost of Egress (network traffic), which can easily dominate
  total costs at multi-TB scale.
- Data locality: processing imagery where it is stored to avoid
  repeated large data transfers.
- Operational complexity of running and maintaining on-prem
  infrastructure versus managed cloud services.

While on-prem compute and non-AWS storage may appear cheaper
at first glance, transferring large datasets between clouds
or from cloud storage to on-prem compute quickly incurs
egress fees that outweigh savings.

For a full cost breakdown and assumptions, see:
https://github.com/hotosm/drone-tm/issues/708

## Decision Outcome

- Host and process imagery entirely inside AWS networks,
  using AWS services.
- Use S3 as the primary object store for both raw uploads
  and processed outputs.
- Use S3 Transfer Acceleration for uploads to improve
  user experience.
- Use CloudFront in front of S3 for downloads and UI access
  to reduce egress costs and benefit from caching.
- Use S3 lifecycle policies (e.g. Intelligent Tiering / Glacier)
  to automatically archive old imagery at very low cost.
- Overspill of processing may use on-prem volunteer hardware
  only in exceptional cases (e.g. very large, one-off projects),
  with the understanding that data transfer costs must be
  carefully managed.

### Consequences

- ✅ Much cheaper network traffic by avoiding cross-cloud or
  cloud-to-on-prem data transfer.
- ✅ Processing happens close to the data, improving throughput
  and reducing overall runtime.
- ✅ Simpler networking and architecture (single cloud boundary).
- ✅ Ability to scale compute elastically using AWS (e.g. spot
  instances, burst capacity).
- ❌ Increased reliance on AWS services.
- ❌ Some vendor lock-in, though most components (Kubernetes,
  S3-compatible tooling) could be migrated if needed.
