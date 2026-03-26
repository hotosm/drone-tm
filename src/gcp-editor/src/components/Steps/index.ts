import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('gcp-step')
export class GcpStep extends LitElement {
  @property({ type: Object }) step: Record<string, any> = {};
  @property({ type: Number }) index: number = 0;
  @property({ type: Boolean }) isLastStep: boolean = false;
  @property({ type: Number }) activeStep: number = 1;

  createRenderRoot() {
    // Return `this` instead of a shadow root, meaning no Shadow DOM is used
    return this;
  }

  protected render(): unknown {
    return html`
      <div class="tw-flex tw-flex-col tw-gap-3">
        <div class="tw-flex tw-items-end tw-font-primary tw-gap-3">
          <p class="tw-ml-2 tw-font-semibold lg:tw-text-xl xl:tw-text-2xl tw-text-gray-600">0${this.step?.step}</p>
          <p class="tw-text-lg tw-text-gray-500 font">${this.step?.label}</p>
        </div>
        <div class="tw-flex tw-items-center">
          <div
            class="tw-flex tw-items-center tw-justify-center tw-rounded-full tw-border-[0.15rem] lg:tw-h-7 lg:tw-w-7 xl:tw-h-9 xl:tw-w-9 tw-border-primary ${this
              .activeStep > this.step.step
              ? 'tw-bg-primary'
              : 'tw-bg-[#ffffff]'}"
          >
            <span
              class="material-symbols-outlined ${this.activeStep > this.step.step
                ? 'tw-text-[#ffffff]'
                : 'tw-text-primary'}"
            >
              check
            </span>
            ${this.activeStep === this.step.step
              ? html`
                  <div
                    class="tw-border-gray-300 tw-border-2 tw-rounded-full lg:tw-h-7 lg:tw-w-7 xl:tw-h-9 xl:tw-w-9 tw-animate-ping tw-duration-100 tw-absolute"
                  ></div>
                `
              : null}
          </div>
          ${this.isLastStep
            ? null
            : html`
                <div
                  class="tw-mx-4 tw-w-[6rem] tw-border-t-[3px] xl:tw-w-[9rem] 2xl:tw-w-[12rem] ${this.activeStep >
                  this.step.step
                    ? 'tw-border-primary'
                    : 'tw-border-dashed'}"
                ></div>
              `}
        </div>
      </div>
    `;
  }
}
