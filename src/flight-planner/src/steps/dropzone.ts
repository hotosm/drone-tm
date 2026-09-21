export interface DropzoneEventDetail {
  files: File[];
}

export function onFilePicked(
  dropzone: Element | null,
  handler: (file: File) => void | Promise<void>,
): void {
  dropzone?.addEventListener("hot-file-change", (event) => {
    const detail = (event as CustomEvent<DropzoneEventDetail>).detail;
    const file = detail?.files?.[0];
    if (file) void handler(file);
  });
}
