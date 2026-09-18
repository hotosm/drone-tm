export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function errorPanel(message: string, guidance: string): string {
  return `
    <wa-callout variant="danger" appearance="outlined" size="s">
      <wa-icon slot="icon" name="circle-exclamation"></wa-icon>
      <strong>${escapeHtml(message)}</strong>
      <p>${escapeHtml(guidance)}</p>
    </wa-callout>`;
}

export function infoPanel(message: string, detail?: string): string {
  return `
    <wa-callout variant="neutral" appearance="outlined" size="s">
      <wa-icon slot="icon" name="circle-info"></wa-icon>
      <strong>${escapeHtml(message)}</strong>
      ${detail ? `<p>${escapeHtml(detail)}</p>` : ""}
    </wa-callout>`;
}

export function successPanel(message: string, detail?: string): string {
  return `
    <wa-callout variant="success" appearance="outlined" size="s">
      <wa-icon slot="icon" name="circle-check"></wa-icon>
      <strong>${escapeHtml(message)}</strong>
      ${detail ? `<p>${escapeHtml(detail)}</p>` : ""}
    </wa-callout>`;
}

export function stat(label: string, value: string, tone = ""): string {
  return `
    <div class="stat ${tone}">
      <span class="stat-label">${escapeHtml(label)}</span>
      <span class="stat-value">${escapeHtml(value)}</span>
    </div>`;
}
