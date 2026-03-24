import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './map-section';
import './gcp-marking-table';
import { Store } from '../../store';
import './raw-image-listing-modal';

@customElement('gcp-marking')
export class GcpMarking extends LitElement {
  @property() selectedGcpDetails = null;
  @property() gcpDataWithXY = Store.getGcpDataWithXY();
  @property() imageList: any = Store.getImageList();

  createRenderRoot() {
    // Return `this` instead of a shadow root, meaning no Shadow DOM is used
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(Store.SELECTED_GCP_DETAILS_UPDATE, this.handleSelectedGcpDetailsUpdate.bind(this));
  }

  disconnectedCallback() {
    document.removeEventListener(Store.SELECTED_GCP_DETAILS_UPDATE, this.handleSelectedGcpDetailsUpdate.bind(this));
    super.disconnectedCallback();
  }

  private handleSelectedGcpDetailsUpdate(event: Event) {
    const CustomEvent = event as CustomEvent<any>;
    this.selectedGcpDetails = CustomEvent.detail;
  }

  private handleNextClick() {
    if (Object.keys(Store.getGcpDataWithXY() || {}).length) {
      Store.setActiveStep(3);
      return;
    }
    alert('No marks on images');
  }

  private handlePreviousClick() {
    Store.setActiveStep(1);
  }

  protected render() {
    return html`
      <div class="tw-grid tw-grid-cols-5 tw-gap-10 tw-h-full tw-w-full tw-bg-[#fff] tw-p-5 tw-rounded-xl">
        <div class="tw-col-span-2 tw-h-full tw-flex tw-flex-col">
          <div class="flex tw-flex-grow">
            <gcp-marking-table></gcp-marking-table>
          </div>
          <div class="tw-h-fit tw-py-5 tw-flex tw-justify-between">
            <hot-button size="small" class="secondary" @click=${() => this.handlePreviousClick()}>
              Previous
              <span slot="prefix" class="material-symbols-outlined !tw-text-lg">chevron_left</span>
            </hot-button>
            <hot-button size="small" class="primary" @click=${() => this.handleNextClick()}>
              Next
              <span slot="suffix" class="material-symbols-outlined !tw-text-lg">chevron_right</span>
            </hot-button>
          </div>
        </div>
        <div class="tw-col-span-3"><map-section></map-section></div>
      </div>
      ${this.selectedGcpDetails
        ? html`
            <hot-dialog
              open
              label="Mark GCP ${this?.selectedGcpDetails?.[0]} on raw images"
              class="dialog-width dialog-deny-close"
              style="--width: 92vw;"
            >
              <div id="image-uploading-content">
                <raw-image-listing-modal></raw-image-listing-modal>
              </div>
            </hot-dialog>
          `
        : null}
    `;
  }
}
