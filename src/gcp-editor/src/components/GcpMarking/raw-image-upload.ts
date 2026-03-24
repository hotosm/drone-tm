import { html, LitElement, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Store } from '../../store';
import spinner from '../../assets/spinner.gif';
import './raw-image-marker';

@customElement('raw-image-upload')
export class RawImageUpload extends LitElement {
  @property() imageList: any = {}; // the list of images of all gcp
  @property() gcpList: any = {}; // the list of all gcp marks
  @property() selectedGcpDetails: any = [];
  @property() rawImageList: any[] = []; // list of active gcp's image list
  @property() gcpMarkList: any = {}; // list of active gcp's image mark

  // pagination
  @state() imagesPerPage = 6;
  @state() numberOfPages = 0;
  @state() currentPage = 1;
  @property() currentStartingIndex = 0;
  @property() currentEndingIndex = 6;
  @property() onViewImages = [];

  private getFirstAndLastIndex = (activePageNumber: number) => {
    let start = 0;
    let end = this.imagesPerPage;
    if (activePageNumber === 1) {
      start = 0;
      end = this.imagesPerPage;
    } else {
      start = (activePageNumber - 1) * this.imagesPerPage;
      end = activePageNumber * this.imagesPerPage;
    }
    return { start, end };
  };

  private goTo(pageNumber: number) {
    const indexes = this.getFirstAndLastIndex(pageNumber);
    this.currentStartingIndex = indexes.start;
    this.currentEndingIndex = indexes.end;
    this.currentPage = pageNumber;
  }
  private next() {
    if (this.currentPage === this.numberOfPages) return;
    const pageNumber = this.currentPage + 1;
    const indexes = this.getFirstAndLastIndex(pageNumber);
    this.currentStartingIndex = indexes.start;
    this.currentEndingIndex = indexes.end;
    this.currentPage = pageNumber;
  }
  private previous() {
    if (this.currentPage === 1) return;
    const pageNumber = this.currentPage - 1;
    const indexes = this.getFirstAndLastIndex(pageNumber);
    this.currentStartingIndex = indexes.start;
    this.currentEndingIndex = indexes.end;
    this.currentPage = pageNumber;
  }

  createRenderRoot() {
    // Return `this` instead of a shadow root, meaning no Shadow DOM is used
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.imageList = Store.getImageList();
    this.gcpList = Store.getGcpDataWithXY();
    this.selectedGcpDetails = Store.getSelectedGcpDetails();
    this.rawImageList = this.imageList?.[this.selectedGcpDetails?.[0]] || [];
    this.gcpMarkList = this.gcpList?.[this.selectedGcpDetails?.[0]] || {};
    this.numberOfPages = this.imageList?.[this.selectedGcpDetails?.[0]]?.length
      ? Math.ceil(this.imageList?.[this.selectedGcpDetails?.[0]].length / this.imagesPerPage)
      : 0;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  private handleFileInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input?.files;
    if (files) {
      this.rawImageList = Object.values(files);
    }
    this.numberOfPages = Math.ceil(this.rawImageList.length / this.imagesPerPage);
  }

  private updateMarkerDetails = (gcpData: any) => {
    this.gcpMarkList = { ...this.gcpMarkList, ...gcpData };
  };

  private updateGcpData() {
    Store.setImageList({ ...this.imageList, [this.selectedGcpDetails[0]]: this.rawImageList });
    Store.setGcpDataWithXY({ ...this.gcpList, [this.selectedGcpDetails[0]]: this.gcpMarkList });
    Store.setSelectedGcpDetails(null);
    this.rawImageList = [];
    this.gcpMarkList = {};
  }

  protected updated(_changedProperties: PropertyValues): void {
    _changedProperties.forEach((_, propName) => {
      if (propName === 'numberOfPages' || propName === 'rawImageList' || propName === 'currentPage') {
        if (this.numberOfPages) {
          this.getOnViewImages();
        }
      }
    });
    super.update(_changedProperties);
  }

  private getOnViewImages = () => {
    const viewData: any = [];
    this.onViewImages = [];
    setTimeout(() => {
      if (!this.currentEndingIndex || !this.rawImageList?.length) return [];
      for (let i = this.currentStartingIndex; i < this.currentEndingIndex; i++) {
        if (!this.rawImageList[i]) break;
        viewData.push({ image: this.rawImageList[i], index: i });
      }
      this.onViewImages = viewData;
    }, 100);
  };

  render() {
    return html`
      <div class="tw-w-full tw-h-full tw-flex tw-flex-col">
        <div class="tw-w-full tw-h-fit">
          <label
            class=" tw-border-gray-400 tw-border-dashed tw-border-2 tw-rounded-lg tw-h-20 tw-w-full tw-flex tw-items-center tw-justify-center tw-relative"
          >
            <input
              type="file"
              id="raw-image-input-element"
              name="gcp-file"
              class="tw-h-24 tw-opacity-0 tw-absolute"
              multiple
              @change=${this.handleFileInputChange}
              accept="image/*"
            />
            <div class="tw-flex tw-flex-col tw-items-center tw-justify-center">
              <span class="material-symbols-outlined tw-text-primary">cloud_upload</span>
              <span class="tw-text tw-font-light">Please upload an image file (.jpg, .png)</span>
            </div>
          </label>
        </div>
        <div class="tw-flex tw-max-h-full tw-gap-4 tw-flex-wrap tw-w-full tw-overflow-y-auto tw-h-[60vh] tw-mt-4">
          ${this.onViewImages.length
            ? this.onViewImages?.map(({ image, index }: any) => {
                return html`
                  <raw-image-marker
                    .imageName=${image.name}
                    .imageUrl=${URL.createObjectURL(image)}
                    index=${index}
                    .gcpMarkerHandler=${this.updateMarkerDetails}
                    .mark=${this.gcpMarkList?.[image.name]}
                    .selectedGcpDetails=${this.selectedGcpDetails}
                  ></raw-image-marker>
                `;
              })
            : this.rawImageList?.length && !this?.onViewImages?.length
            ? html`
                <div class="tw-flex tw-justify-center tw-items-center tw-w-full">
                  <div class="tw-w-[200px] tw-h-[200px]:">
                    <img src=${spinner} />
                  </div>
                </div>
              `
            : html`
                <div></div>
              `}
        </div>
      </div>
      <div class="tw-flex tw-justify-between tw-w-full tw-absolute tw-bottom-4">
        <div></div>
        ${this.rawImageList?.length
          ? html`
              <div class="tw-flex tw-gap-1">
                <hot-button size="small" @click=${() => this.previous()}><<</hot-button>
                ${[...Array(this.numberOfPages)].map(
                  (_, index) =>
                    html`
                      <hot-button
                        size="small"
                        class=${this.currentPage === index + 1 ? 'is-active' : ''}
                        @click=${() => this.goTo(index + 1)}
                      >
                        ${index + 1}
                      </hot-button>
                    `
                )}
                <hot-button size="small" class="active-btn" @click=${() => this.next()}>>></hot-button>
              </div>
            `
          : html`
              <div></div>
            `}
        <hot-button size="small" class="primary" @click=${() => this.updateGcpData()}>Save Changes</hot-button>
      </div>
    `;
  }
}
