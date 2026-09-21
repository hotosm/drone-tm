import { afterEach, describe, expect, it } from "vitest";
import { mainSiteUrl, projectUrl } from "../src/core/http";

type RuntimeGlobal = typeof globalThis & {
  __RUNTIME_CONFIG__?: Record<string, string | undefined>;
};

function servedAt(url: string): void {
  Object.defineProperty(globalThis, "location", {
    value: new URL(url),
    configurable: true,
  });
}

afterEach(() => {
  delete (globalThis as RuntimeGlobal).__RUNTIME_CONFIG__;
});

describe("mainSiteUrl", () => {
  it("stays on this origin when served under the main app, so localhost is not production", () => {
    servedAt("http://localhost:3040/plan/");
    expect(mainSiteUrl()).toBe("http://localhost:3040/");
  });

  it("works from a page inside the planner, not just its root", () => {
    servedAt("http://localhost:3040/plan/index.html");
    expect(mainSiteUrl()).toBe("http://localhost:3040/");
  });

  it("keeps whatever path the main app is mounted at", () => {
    servedAt("https://example.test/dronetm/plan/");
    expect(mainSiteUrl()).toBe("https://example.test/dronetm/");
  });

  it("uses the deployment's own setting before anything it can infer", () => {
    servedAt("http://localhost:3040/plan/");
    (globalThis as RuntimeGlobal).__RUNTIME_CONFIG__ = {
      VITE_MAIN_SITE_URL: "https://staging.drone.example",
    };
    expect(mainSiteUrl()).toBe("https://staging.drone.example/");
  });

  it("stays on the origin it was served from when it is not under /plan", () => {
    servedAt("https://drone.hotosm.org/");
    expect(mainSiteUrl()).toBe("https://drone.hotosm.org/");
  });
});

describe("projectUrl", () => {
  it("points back at the project the handoff came from", () => {
    servedAt("http://localhost:3040/plan/");
    expect(projectUrl("4f3c1a2b")).toBe("http://localhost:3040/projects/4f3c1a2b");
  });

  it("escapes the id rather than building a broken path", () => {
    servedAt("https://drone.hotosm.org/plan/");
    expect(projectUrl("a/b")).toBe("https://drone.hotosm.org/projects/a%2Fb");
  });
});
