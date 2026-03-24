import '@hotosm/ui/dist/style-core.css';
import './style.css';

import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Store } from './store';
import '@hotosm/ui/dist/hotosm-ui.js';
import './components/GcpDataInput/index';
import './components/GcpMarking/index';
import './components/GcpResult/index';
import './components/Steps';

const steps = [
  { label: 'Upload GCPs', step: 1 },
  { label: 'Mark GCPs', step: 2 },
  { label: 'Final Processing', step: 3 },
];

@customElement('gcp-editor')
export class GcpEditor extends LitElement {
  @property({}) customEvent = null;
  @property({}) finalButtonText = 'Download';
  @property({ type: String }) rawImageUrl = '';
  @property({ type: String }) cogUrl = '';
  @property({ type: Number }) activeStep = 1;
  @property() gcpData = null;
  @property() setGcpDataWithXY = {};

  createRenderRoot() {
    // Return `this` instead of a shadow root, meaning no Shadow DOM is used
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    Store.setRawImageUrl(this.rawImageUrl);
    Store.setCogUrl(this.cogUrl);

    // Listen for updates to CSV data
    document.addEventListener(Store.GCP_DATA_UPDATE, this.handleGcpDataUpdate.bind(this));
    document.addEventListener(Store.GCP_DATA_WITH_IMAGE_XY_UPDATE, this.handleGcpDataWithXYUpdate.bind(this));
    document.addEventListener(Store.ACTIVE_STEP_UPDATE, this.handleActiveStepUpdate.bind(this));
  }

  disconnectedCallback() {
    document.removeEventListener(Store.GCP_DATA_UPDATE, this.handleGcpDataUpdate.bind(this));
    document.removeEventListener(Store.GCP_DATA_WITH_IMAGE_XY_UPDATE, this.handleGcpDataWithXYUpdate.bind(this));
    document.removeEventListener(Store.ACTIVE_STEP_UPDATE, this.handleActiveStepUpdate.bind(this));
    Store.clearState();
    super.disconnectedCallback();
  }

  handleGcpDataUpdate(event: Event) {
    const CustomEvent = event as CustomEvent<any>;
    this.gcpData = CustomEvent?.detail;
  }

  handleGcpDataWithXYUpdate(event: Event) {
    const CustomEvent = event as CustomEvent<any>;
    this.setGcpDataWithXY = CustomEvent?.detail;
  }

  handleActiveStepUpdate(event: Event) {
    const CustomEvent = event as CustomEvent<any>;
    this.activeStep = CustomEvent.detail;
  }

  render() {
    return html`
      <div class="tw-h-full tw-w-full tw-bg-[#ffffff] tw-font-primary">
        <div class="tw-flex tw-flex-col tw-gap-3 tw-h-full tw-w-full">
          <div class="tw-flex tw-gap-2 tw-justify-center tw-py-3 tw-w-full">
            ${steps?.map(
              (step, index) =>
                html`
                  <gcp-step
                    .step=${step}
                    index=${index}
                    .isLastStep=${index === steps.length - 1}
                    activeStep=${this.activeStep}
                  ></gcp-step>
                `
            )}
          </div>
          <div class="tw-h-full tw-w-full">
            ${this.activeStep === 1
              ? html`
                  <gcp-data-input></gcp-data-input>
                `
              : this.activeStep === 2
              ? html`
                  <gcp-marking></gcp-marking>
                `
              : html`
                  <gcp-result .customEvent=${this.customEvent} buttonText=${this.finalButtonText}></gcp-result>
                `}
          </div>
        </div>
      </div>
    `;
  }
}
