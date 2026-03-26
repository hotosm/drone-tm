import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Store } from '../../store';
import uploadImage from '../../assets/uploadIcon.png';

@customElement('gcp-marking-table')
export class GcpMarkingTable extends LitElement {
  @property({ type: Object }) gcpData: String[][] = Store.getGcpData();
  @property() gcpDataWithImageXY: any = Store.getGcpDataWithXY() || {};
  @state() activeGcp: any = Store.getActiveGcp();

  connectedCallback() {
    super.connectedCallback();
    // Listen for updates to CSV data
    document.addEventListener(Store.GCP_DATA_WITH_IMAGE_XY_UPDATE, this.handleGcpUpdate.bind(this));
    document.addEventListener(Store.ACTIVE_GCP_UPDATE, this.handleActiveGcpUpdate.bind(this));
  }

  disconnectedCallback() {
    document.removeEventListener(Store.GCP_DATA_WITH_IMAGE_XY_UPDATE, this.handleGcpUpdate.bind(this));
    document.removeEventListener(Store.ACTIVE_GCP_UPDATE, this.handleActiveGcpUpdate.bind(this));
    super.disconnectedCallback();
  }

  static styles = css`
    :host {
      display: block;
      padding: 10px;
      width: 100%;
      max-height: 100%;
    }
    /* Wrapper for the table */
    .table-wrapper {
      width: 100%;
      overflow-x: auto; /* Enable horizontal scrolling when the table overflows */
      -webkit-overflow-scrolling: touch; /* Smooth scrolling for mobile devices */
      margin-top: 0px; /* Optional: to maintain top margin */
      overflow: auto;
      max-height: 60vh;
    }

    table {
      width: 100%; /* Ensure the table takes up 100% of its container's width */
      border-collapse: collapse;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
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

    table th:first-child {
      border-radius: 10px 0 0 0;
    }

    table th:last-child {
      border-radius: 0 10px 0 0;
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
    .upload-wrapper {
      display: flex;
      gap: 10px;
      cursor: pointer;
    }

    .upload-wrapper:hover {
      text-decoration: underline;
      text-decoration-color: red;
    }

    .upload-wrapper > span {
      color: red;
      font-weight: 600;
    }
    tr:hover {
      background: #f9d3d3;
      cursor: pointer;
    }

    .active {
      background: #f9d3d3;
    }
  `;

  private handleGcpDataSelection(rowdata: any) {
    Store.setSelectedGcpDetails(rowdata);
  }

  private handleGcpUpdate = (event: Event) => {
    const CustomEvent = event as CustomEvent<any>;
    this.gcpDataWithImageXY = CustomEvent.detail;
  };

  private handleActiveGcpUpdate(event: Event) {
    const CustomEvent = event as CustomEvent<any>;
    this.activeGcp = CustomEvent.detail;
  }

  getMarkedImageCount = (gcpLabel: any) => {
    if (!gcpLabel || !this.gcpDataWithImageXY || !Object.keys(this.gcpDataWithImageXY || {}).length) return 0;
    const count = Object.keys(this.gcpDataWithImageXY?.[gcpLabel] || {}).length;
    return count || 0;
  };

  protected render() {
    return html`
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Marked image count</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${this.gcpData.slice(1).map(
              (row: Array<String>) => html`
                <tr class=${this.activeGcp?.[0] === row?.[0] ? 'active' : ''} @click=${() => Store.setActiveGcp(row)}>
                  <td>
                    <span>${row[0]}</span>
                  </td>
                  <td>${this.getMarkedImageCount(row[0])}</td>
                  <td>
                    <div class="upload-wrapper" @click=${() => this.handleGcpDataSelection(row)}>
                      <img src=${uploadImage} />
                      <span>Image</span>
                    </div>
                  </td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }
}
