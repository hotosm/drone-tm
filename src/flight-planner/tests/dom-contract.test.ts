import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, root)), "utf-8");

const html = read("index.html");
const mainTs = read("src/main.ts");

function assertedIds(source: string): string[] {
  return [...source.matchAll(/querySelector<[^>]*>\("#([\w-]+)"\)!/g)].map((m) => m[1]);
}

function documentIds(source: string): string[] {
  return [
    ...source.matchAll(/(?:^|[^.\w])document\.querySelector(?:<[^>]*>)?\("#([\w-]+)"\)/g),
  ].map((m) => m[1]);
}

function optionalIds(source: string): string[] {
  return [...source.matchAll(/querySelector\("#([\w-]+)"\)/g)].map((m) => m[1]);
}

function htmlIds(source: string): Set<string> {
  return new Set([...source.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
}

describe("index.html satisfies main.ts", () => {
  const present = htmlIds(html);

  it.each(assertedIds(mainTs))("has #%s, which main.ts asserts exists", (id) => {
    expect(present).toContain(id);
  });

  it.each([...new Set(documentIds(mainTs))])("has #%s, which main.ts wires up", (id) => {
    expect(present).toContain(id);
  });

  it("renders the nav buttons it later wires up", () => {
    const navIds = new Set(
      [...mainTs.matchAll(/navHost\.querySelector\("#([\w-]+)"\)/g)].map((m) => m[1]),
    );

    expect(navIds.size).toBeGreaterThan(0);
    for (const id of navIds) {
      expect(mainTs, `renderNav should emit id="${id}"`).toContain(`id="${id}"`);
    }
  });

  it("loads the app entry point", () => {
    expect(html).toContain('src="/src/main.ts"');
  });

  it.each([
    ["wa-theme-default", "the HOT light theme"],
    ["wa-palette-hotosm", "the HOT colour palette"],
    ["wa-cloak", "the FOUCE backstop"],
  ])("keeps %s on <html>, which switches on %s", (className) => {
    expect(html).toMatch(new RegExp(`<html[^>]*\\bclass="[^"]*\\b${className}\\b`, "s"));
  });

  it("uses no Font Awesome Pro icon styles", () => {
    // Only solid and brands are free; the rest 403 and render an empty <svg>.
    const sources = [html, ...["tutorial/index", "steps/ui"].map((m) => read(`src/${m}.ts`))];
    for (const source of sources) {
      expect(source).not.toMatch(/<wa-icon[^>]*variant="(regular|light|thin|duotone)"/);
    }
  });

  it("declares a viewport that respects device notches", () => {
    expect(html).toMatch(/viewport-fit=cover/);
  });
});

describe("each step wires up what it renders", () => {
  const steps = [
    "src/steps/step1-area.ts",
    "src/steps/step2-params.ts",
    "src/steps/step3-dem.ts",
    "src/steps/step4-generate.ts",
  ];

  it.each(steps)("%s only queries ids it also renders", (path) => {
    const source = read(path);
    const rendered = htmlIds(source);
    const queried = new Set(
      [
        ...assertedIds(source),
        ...optionalIds(source),
        ...[...source.matchAll(/querySelector<[^>]*>\(`#\$\{(\w+)\}`\)/g)].map(() => null),
      ].filter((id): id is string => id !== null),
    );

    for (const id of queried) {
      expect(rendered, `${path} queries #${id} but never renders it`).toContain(id);
    }
  });

  it.each(steps)("%s escapes interpolated text", (path) => {
    const source = read(path);
    if (/\$\{/.test(source)) expect(source).toMatch(/escapeHtml|coachLead/);
  });
});
