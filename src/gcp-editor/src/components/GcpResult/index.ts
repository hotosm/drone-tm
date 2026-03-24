import { css, html, LitElement, PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Store } from '../../store';
import chevronLeft from '../../assets/chevronLeft.png';

// Define the type for a row in the gcp.txt file
// [X Y Z ImageX ImageY FileName.jpg]
// e.g. 544256.7 5320919.9 5 3044 2622 IMG_0525.jpg
// https://docs.opendronemap.org/gcp/
type GcpRow = [number, number, number, number, number, string, string];
// Plus we define the headers row separately
type GcpHeaders = [string, string, string, string, string, string, string];
// Then combined GcpFile
type GcpFile = Array<GcpHeaders | GcpRow>;

/**
 * GcpResult Component
 *
 * This component renders a list of Ground Control Points (GCP) as a table
 * and provides functionality to download the data in a custom text format.
 */
@customElement('gcp-result')
export class GcpResult extends LitElement {
  /**
   * Property: gcpList
   * Holds the raw GCP data fetched from the store.
   */
  @property() gcpList = Store.getGcpDataWithXY();
  @property({ type: String }) buttonText = '';
  @property({ type: String }) customEvent = null;

  /**
   * Property: gcpInCsv
   * A processed version of `gcpList` that represents GCP data as an array of rows.
   */
  @property() gcpInCsv: GcpFile = [];

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background: white;
      height: 100%;
      width: 100%;
      border-radius: 12px;
    }
    /* Wrapper for the table */
    .table-wrapper {
      width: 100%;
      overflow-x: auto; /* Enable horizontal scrolling when the table overflows */
      -webkit-overflow-scrolling: touch; /* Smooth scrolling for mobile devices */
      margin-top: 20px; /* Optional: to maintain top margin */
      overflow: auto;
      max-height: 60vh;
    }

    table {
      width: 100%; /* Ensure the table takes up 100% of its container's width */
      border-collapse: collapse;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    table th:first-child {
      border-radius: 10px 0 0 0;
    }

    table th:last-child {
      border-radius: 0 10px 0 0;
    }

    th,
    td {
      padding: 12px 15px;
      text-align: left;
      font-size: 14px;
      border-bottom: 1px solid #ddd;
    }

    th {
      background-color: #f73f3f;
      color: white;
      font-weight: bold;
    }

    tr:hover {
      background-color: #ffeded;
      cursor: pointer;
    }

    td {
      color: #555;
    }

    td,
    th {
      border-left: 1px solid #ddd;
    }

    td:first-child,
    th:first-child {
      border-left: none;
    }
    .button-wrapper {
      padding: 20px 20px;
      display: flex;
      justify-content: space-between;
      justify-items: center;
      gap: 10px;
    }

    .main-btns {
      display: flex;
      justify-content: center;
      justify-items: center;
      gap: 10px;
    }

    /* primary button */
    hot-button.primary::part(base) {
      background-color: #d73f3f;
      color: white !important;
      border: 0px;
      font-weight: 600;
      font-family: 'Barlow Condensed';
      padding: 4px 4px;
      font-size: 14px;
    }

    hot-button.primary::part(base):hover {
      background-color: #b91c1c;
    }

    /* secondary button */
    hot-button.secondary::part(base) {
      background-color: white;
      color: #d73f3f !important;
      border: 0px;
      font-weight: 600;
      font-family: 'Barlow Condensed';
      padding: 4px 4px;
      font-size: 14px;
    }
    hot-button.secondary::part(base):hover {
      -webkit-box-shadow: -2px 2px 23px -6px rgba(0, 0, 0, 0.5);
      -moz-box-shadow: -2px 2px 23px -6px rgba(0, 0, 0, 0.5);
      box-shadow: -2px 2px 23px -6px rgba(0, 0, 0, 0.5);
    }

    hot-button.download::part(base):hover {
      background-color: #ff7b00;
      font-weight: 600;
      font-family: 'Barlow Condensed';
      padding: 4px 4px;
      font-size: 14px;
    }
    hot-button.download::part(base) {
      background-color: #ffa500;
      color: white !important;
      border: 0px;
    }
  `;

  /**
   * Lifecycle method: firstUpdated
   * Called when the component is first rendered. Processes the GCP list into a usable format.
   * @param _changedProperties Properties that changed when the component updated.
   */
  protected firstUpdated(_changedProperties: PropertyValues): void {
    this.gcpInCsv = this.convertToArray(this.gcpList);
  }

  /**
   * Converts raw GCP data into an array of rows.
   * Each row represents a single GCP entry.
   * @param data The raw GCP data to process.
   * @returns An array of rows with headers included.
   */
  private convertToArray(data: any): GcpFile {
    const result: GcpFile = [];
    const headers: GcpHeaders = ['X', 'Y', 'Z', 'Image X', 'Image Y', 'File Name', 'Gcp Label'];

    // Add headers (these are removed on download, but there for information only)
    result.push(headers);

    for (const group in data) {
      for (const fileName in data[group]) {
        const entry = data[group][fileName];
        result.push([
          entry.X, // X
          entry.Y, // Y
          entry.Z, // Z
          entry.imageX, // Image X
          entry.imageY, // Image Y
          entry.fileName, // File Name
          entry.gcpLabel, // Gap Label
        ]);
      }
    }

    return result;
  }

  /**
   * Handles the GCP file download functionality.
   * Generates a space-separated text file in a custom format and triggers its download.
   */
  private handleGcpFileDownload() {
    if (!this.gcpInCsv || this.gcpInCsv.length <= 1) return;

    // Header for the projection (hardcoded for now)
    // TODO support other coord systems / not hardcoded to EPSG:4326
    const header = '+proj=utm +zone=10 +ellps=WGS84 +datum=WGS84 +units=m +no_defs\n';

    // Convert GCP data to space-separated rows
    const rows = this.gcpInCsv
      .slice(1) // Skip headers
      .map((row) => `${row[0]} ${row[1]} ${row[2]} ${row[3]} ${row[4]} ${row[5]}`) // Format: X Y Z ImageX ImageY FileName
      .join('\n');

    const finalContent = header + rows;
    // Create a Blob for the file and trigger download
    const blob = new Blob([finalContent], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = 'gcp.txt';
    a.style.display = 'none';

    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  handlePreviousClick() {
    Store.setActiveStep(2);
  }

  handleFinalButtonClick() {
    if (this.customEvent) {
      if (!this.gcpInCsv || this.gcpInCsv.length <= 1) return;
      // Header for the projection (hardcoded for now)
      // TODO support other coord systems / not hardcoded to EPSG:4326
      const header = '+proj=utm +zone=10 +ellps=WGS84 +datum=WGS84 +units=m +no_defs\n';
      // Convert GCP data to space-separated rows
      const rows = this.gcpInCsv
        .slice(1) // Skip headers
        .map((row) => `${row[0]} ${row[1]} ${row[2]} ${row[3]} ${row[4]} ${row[5]}`) // Format: X Y Z ImageX ImageY FileName
        .join('\n');

      const finalContent = header + rows;
      // dispatch a custom event sent as a prop and set final content on detail of event.
      document.dispatchEvent(new CustomEvent(this.customEvent, { detail: finalContent }));
    }
  }

  render() {
    return html`
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              ${(this.gcpInCsv?.[0] as GcpHeaders)?.map((header: string) =>
                typeof header === 'string'
                  ? html`
                      <th>${header}</th>
                    `
                  : null
              )}
            </tr>
          </thead>
          <tbody>
            ${this.gcpInCsv.slice(1).map((row: GcpRow | GcpHeaders) =>
              Array.isArray(row) && !Number.isNaN(row[0])
                ? html`
                    <tr>
                      ${row.map(
                        (cell: string | number) =>
                          html`
                            <td>${cell}</td>
                          `
                      )}
                    </tr>
                  `
                : null
            )}
          </tbody>
        </table>
      </div>
      <div class="button-wrapper">
        <hot-button size="small" class="secondary" @click=${this.handlePreviousClick}>
          <img src=${chevronLeft} style="padding-right:12px" />
          Previous
        </hot-button>
        <div class="main-buttons">
          <hot-button
            size="small"
            class=${this.customEvent ? 'download' : 'primary'}
            @click=${this.handleGcpFileDownload}
          >
            Download
          </hot-button>
          ${this.customEvent
            ? html`
                <hot-button size="small" class="primary" @click=${this.handleFinalButtonClick}>
                  ${this.buttonText}
                </hot-button>
              `
            : null}
        </div>
      </div>
    `;
  }
}
