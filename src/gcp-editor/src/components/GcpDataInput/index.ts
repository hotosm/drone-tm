import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import './csv-upload';
import { Store } from '../../store';
import sampleFile from '../../assets/sample.csv';

@customElement('gcp-data-input')
export class GcpDataInput extends LitElement {
  @property({ type: String }) projection: string = Store.getProjection();
  @state() errorMessage: string = '';

  createRenderRoot() {
    // Return `this` instead of a shadow root, meaning no Shadow DOM is used
    return this;
  }

  handleNextClick() {
    if (!Store.getGcpData()?.length) {
      this.errorMessage = 'Please upload csv file';
      return;
    }
    this.errorMessage = '';
    Store.setActiveStep(2);
  }

  render() {
    return html`
      <div class="tw-grid tw-grid-cols-3 tw-gap-10 tw-h-full tw-w-full">
        <div
          class="tw-bg-[#fff] tw-w-full tw-h-full tw-p-5 tw-min-h-80 tw-col-span-1 tw-rounded-xl tw-border tw-shadow-lg"
        >
          <h1 class="tw-font-semibold tw-text-base">CSV Specification</h1>
          <ul class="tw-list-decimal tw-list-inside">
            <li class="tw-py-1 ">The Csv must contain at least 4 columns</li>
            <li class="tw-py-1 ">The first row (header) must be GCP Label, X, Y, Z</li>
            <li>No cells can be left blank</li>
            <li class="tw-py-1 ">
              Each subsequent row contains the label and coordinates of your ground control points (in the EPSG:4326)
            </li>
            <li class="tw-py-1 ">GCP Labels must be unique</li>
            <li class="tw-py-4 tw-flex tw-items-center">
              <span>Download example csv</span>
              <a
                href=${sampleFile}
                download="sample.csv"
                class="material-symbols-outlined hover:tw-border-primary tw-cursor-pointer tw-px-1 tw-border-2 tw-border-[#fff]  tw-bg-primary tw-rounded-full tw-mx-2 !tw-text-base tw-text-[#fff] tw-transition-all tw-delay-150"
                title="download sample .csv"
              >
                download
              </a>
            </li>
          </ul>
        </div>

        <div
          class="tw-flex tw-flex-col tw-gap-5 tw-col-span-2 tw-bg-[#fff] tw-p-5 tw-rounded-xl tw-relative tw-border tw-shadow-lg"
        >
          <csv-upload errorMessage=${this.errorMessage}></csv-upload>

          <div class="tw-absolute tw-bottom-4 tw-right-10">
            <hot-button size="small" class="primary" @click=${() => this.handleNextClick()}>
              Next
              <span slot="suffix" class="material-symbols-outlined !tw-text-lg">chevron_right</span>
            </hot-button>
          </div>
        </div>
      </div>
    `;
  }
}
