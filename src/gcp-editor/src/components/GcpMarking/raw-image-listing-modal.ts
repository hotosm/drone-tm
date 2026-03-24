import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Store } from '../../store';
import './raw-image-fetch';
import './raw-image-upload';

@customElement('raw-image-listing-modal')
export class RawImageUpload extends LitElement {
  @property() imageUrl: string = '';

  createRenderRoot() {
    // Return `this` instead of a shadow root, meaning no Shadow DOM is used
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.imageUrl = Store.getRawImageUrl();
    // Prevent the dialog from closing when the user clicks on the overlay
    const dialog = document.querySelector('.dialog-deny-close') as HTMLElement;
    dialog.addEventListener('wa-hide', (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.source === 'overlay') {
        event.preventDefault();
      }
      Store.setSelectedGcpDetails(null);
    });
  }

  disconnectedCallback() {
    // Prevent the dialog from closing when the user clicks on the overlay
    const dialog = document.querySelector('.dialog-deny-close') as HTMLElement;
    dialog?.removeEventListener('wa-hide', () => {});
    super.disconnectedCallback();
  }

  render() {
    return html`
      <div class="tw-h-[80vh] tw-relative tw-pb-16">
        <div class="tw-flex tw-flex-col tw-h-full tw-w-full">
          ${this.imageUrl
            ? html`
                <raw-image-fetch></raw-image-fetch>
              `
            : html`
                <raw-image-upload></raw-image-upload>
              `}
        </div>
      </div>
    `;
  }
}
