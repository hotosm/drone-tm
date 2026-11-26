import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PARAMS } from "../src/core/flightplan";
import { step4 } from "../src/steps/step4-generate";
import type { StepContext } from "../src/app";

vi.mock("../src/tutorial", () => ({ coachLead: () => "" }));
vi.mock("../src/checklist", () => ({}));

function render(droneType: typeof DEFAULT_PARAMS.droneType, potensicApp: "android" | "ios") {
  return step4.render({
    state: {
      aoi: {},
      params: { ...DEFAULT_PARAMS, droneType, potensicApp },
      dem: { skipped: true },
      result: null,
    },
  } as unknown as StepContext);
}

describe("Atom 2 platform choices", () => {
  it("offers both platforms in the existing drone dropdown, with iOS selected", () => {
    const html = render("POTENSIC_ATOM_2", "ios");
    expect(html).toContain('value="POTENSIC_ATOM_2_ios"');
    expect(html).toContain("Atom 2 (Android)");
    expect(html).toContain("Atom 2 (iOS)");
    expect(html).not.toContain('id="potensic-app"');
  });

  it("retains other drone choices without assigning them a platform", () => {
    const html = render("DJI_MINI_4_PRO", "android");
    expect(html).toContain('value="DJI_MINI_4_PRO"');
    expect(html).not.toContain("DJI_MINI_4_PRO_android");
  });
});
