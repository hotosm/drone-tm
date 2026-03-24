import { html, LitElement, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Store } from '../../store';
import spinner from '../../assets/spinner.gif';

@customElement('raw-image-fetch')
export class RawImageFetch extends LitElement {
  @property() imageList: any = {}; // the list of images of all gcp
  @property() gcpList: any = {}; // the list of all gcp marks
  @property() selectedGcpDetails: any = [];
  @property() rawImageList: any[] = []; // list of active gcp's image list
  @property() gcpMarkList: any = {}; // list of active gcp's image mark
  @property() imageUrl: string = '';
  @state() isLoadingImages = false;

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

  async connectedCallback() {
    super.connectedCallback();
    this.imageUrl = Store.getRawImageUrl();
    this.imageList = Store.getImageList();
    this.gcpList = Store.getGcpDataWithXY();
    this.selectedGcpDetails = Store.getSelectedGcpDetails();
    this.rawImageList = this.imageList?.[this.selectedGcpDetails?.[0]] || [];
    this.gcpMarkList = this.gcpList?.[this.selectedGcpDetails?.[0]] || {};
    this.numberOfPages = this.imageList?.[this.selectedGcpDetails?.[0]]?.length
      ? Math.ceil(this.imageList?.[this.selectedGcpDetails?.[0]]?.length / this?.imagesPerPage)
      : 0;

    if (!this.rawImageList || (!this.rawImageList?.length && this.imageUrl)) {
      this.isLoadingImages = true;
      this.fetchImages(this.imageUrl);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
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

  private async fetchImages(url: string) {
    try {
      const response = await fetch(`${url}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          longitude: this.selectedGcpDetails[2],
          latitude: this.selectedGcpDetails[1],
        }),
      });
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      this.rawImageList = await response.json();
      this.numberOfPages = Math.ceil(this.rawImageList.length / this.imagesPerPage);
    } catch (error) {
      console.error('There was a problem with the fetch operation:', error);
    } finally {
      this.isLoadingImages = false;
    }
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

  getFileName(fileUrl: string): string {
    const parsedUrl = new URL(fileUrl);
    const pathSegments = parsedUrl.pathname.split('/');
    const fileName = pathSegments[pathSegments.length - 1];
    return fileName;
  }

  render() {
    return html`
      <div class="tw-flex tw-max-h-full tw-gap-4 tw-flex-wrap tw-w-full tw-overflow-y-auto tw-h-[70vh] tw-mt-4">
        ${this.isLoadingImages
          ? html`
              <div class="tw-flex tw-justify-center tw-items-center tw-w-full">
                <div class="tw-w-[200px] tw-h-[200px]:">
                  <img src=${spinner} />
                </div>
              </div>
            `
          : this.onViewImages.length
          ? this.onViewImages?.map(
              ({ image, index }: any) => html`
                <raw-image-marker
                  .imageName=${this.getFileName(image)}
                  .imageUrl=${image}
                  index=${index}
                  .gcpMarkerHandler=${this.updateMarkerDetails}
                  .mark=${this.gcpMarkList?.[this.getFileName(image)]}
                  .selectedGcpDetails=${this.selectedGcpDetails}
                ></raw-image-marker>
              `
            )
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
