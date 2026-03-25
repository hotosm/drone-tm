import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Store } from '../../store';
import './raw-image-fetch';
import './raw-image-upload';

/**
 * Modal that manages image sourcing for GCP marking.
 *
 * Strategy:
 * - If rawImageUrl is configured (e.g. drone-tm), try fetching matching images
 *   from the backend first. If the fetch fails or returns no results, fall back
 *   to manual upload.
 * - If no rawImageUrl (standalone / WebODM integration), go straight to upload.
 */
@customElement('raw-image-listing-modal')
export class RawImageListingModal extends LitElement {
  @property() imageUrl: string = '';
  @state() mode: 'loading' | 'fetch' | 'upload' = 'upload';
  /** Pre-fetched image URLs passed to raw-image-fetch when available */
  @state() fetchedImages: string[] = [];

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.imageUrl = Store.getRawImageUrl();

    // Prevent the dialog from closing when the user clicks on the overlay
    const dialog = document.querySelector('.dialog-deny-close') as HTMLElement;
    dialog?.addEventListener('wa-hide', (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.source === 'overlay') {
        event.preventDefault();
      }
      Store.setSelectedGcpDetails(null);
    });

    if (this.imageUrl) {
      // Check if we already have cached images for this GCP
      const selectedGcp = Store.getSelectedGcpDetails();
      const cachedImages = Store.getImageList()?.[selectedGcp?.[0]];
      if (cachedImages?.length) {
        this.fetchedImages = cachedImages;
        this.mode = 'fetch';
      } else {
        this.mode = 'loading';
        this._tryFetchImages(selectedGcp);
      }
    } else {
      this.mode = 'upload';
    }
  }

  disconnectedCallback() {
    const dialog = document.querySelector('.dialog-deny-close') as HTMLElement;
    dialog?.removeEventListener('wa-hide', () => {});
    super.disconnectedCallback();
  }

  private async _tryFetchImages(selectedGcp: any) {
    try {
      const response = await fetch(this.imageUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          longitude: selectedGcp[2],
          latitude: selectedGcp[1],
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const images = await response.json();
      if (images?.length) {
        this.fetchedImages = images;
        this.mode = 'fetch';
        return;
      }
    } catch (error) {
      console.warn('Image fetch failed, falling back to manual upload:', error);
    }
    // Empty result or error → upload mode
    this.mode = 'upload';
  }

  render() {
    return html`
      <div class="tw-h-[80vh] tw-relative tw-pb-16">
        <div class="tw-flex tw-flex-col tw-h-full tw-w-full">
          ${this.mode === 'loading'
            ? html`
                <div class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-h-full tw-gap-4">
                  <div class="tw-animate-spin tw-h-8 tw-w-8 tw-border-4 tw-border-primary tw-border-t-transparent tw-rounded-full"></div>
                  <span class="tw-text-gray-500">Searching for matching images...</span>
                </div>
              `
            : this.mode === 'fetch'
            ? html`<raw-image-fetch .prefetchedImages=${this.fetchedImages}></raw-image-fetch>`
            : html`<raw-image-upload></raw-image-upload>`}
        </div>
      </div>
    `;
  }
}
