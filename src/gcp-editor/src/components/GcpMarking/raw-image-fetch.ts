import { html, LitElement, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Store } from "../../store";
import "./raw-image-marker";

/**
 * Displays fetched S3 images for GCP marking with pagination.
 * Images are passed in via the `prefetchedImages` property (fetched by the parent modal).
 */
@customElement("raw-image-fetch")
export class RawImageFetch extends LitElement {
  /** Pre-fetched image URLs from the parent modal */
  @property({ type: Array }) prefetchedImages: string[] = [];

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
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.imageList = Store.getImageList();
    this.gcpList = Store.getGcpDataWithXY();
    this.selectedGcpDetails = Store.getSelectedGcpDetails();
    this.gcpMarkList = this.gcpList?.[this.selectedGcpDetails?.[0]] || {};

    // Use cached images if available, otherwise use prefetched from parent
    const cached = this.imageList?.[this.selectedGcpDetails?.[0]];
    this.rawImageList = cached?.length ? cached : this.prefetchedImages;
    this.numberOfPages = Math.ceil(this.rawImageList.length / this.imagesPerPage);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
  }

  protected updated(_changedProperties: PropertyValues): void {
    _changedProperties.forEach((_, propName) => {
      if (
        propName === "numberOfPages" ||
        propName === "rawImageList" ||
        propName === "currentPage"
      ) {
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
    const pathSegments = parsedUrl.pathname.split("/");
    const fileName = pathSegments[pathSegments.length - 1];
    return fileName;
  }

  render() {
    return html`
      <div class="tw-flex tw-max-h-full tw-gap-4 tw-flex-wrap tw-w-full tw-overflow-y-auto tw-h-[70vh] tw-mt-4">
        ${
          this.onViewImages.length
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
              `,
              )
            : html`
                <div></div>
              `
        }
      </div>
      <div class="tw-flex tw-justify-between tw-w-full tw-absolute tw-bottom-4">
        <div></div>
        ${
          this.rawImageList?.length
            ? html`
              <div class="tw-flex tw-gap-1">
                <wa-button size="small" @click=${() => this.previous()}><<</wa-button>
                ${[...Array(this.numberOfPages)].map(
                  (_, index) =>
                    html`
                      <wa-button
                        size="small"
                        class=${this.currentPage === index + 1 ? "is-active" : ""}
                        @click=${() => this.goTo(index + 1)}
                      >
                        ${index + 1}
                      </wa-button>
                    `,
                )}
                <wa-button size="small" class="active-btn" @click=${() => this.next()}>>></wa-button>
              </div>
            `
            : html`
                <div></div>
              `
        }
        <wa-button size="small" class="primary" @click=${() => this.updateGcpData()}>Save Changes</wa-button>
      </div>
    `;
  }
}
