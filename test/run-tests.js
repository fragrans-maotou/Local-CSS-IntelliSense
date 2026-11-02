"use strict";

const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

const {
  dedupeEntries,
  mergeEntries,
  removeDuplicateEntries,
  sortEntriesByPriority,
  getEntrySignature
} = require("../src/utils");
const { filterEntriesForElement } = require("../src/selector-relevance");
const { extractStyleDependencies, parseCssEntries } = require("../src/parsing");

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

function makeEntry(overrides) {
  return {
    className: "btn",
    selector: ".btn",
    filePath: "/project/styles/a.css",
    line: 1,
    column: 1,
    declarations: "color: red;",
    contextLabel: "",
    sourceKind: "global",
    ...overrides
  };
}

test("dedupeEntries collapses same rule with different columns", () => {
  const left = makeEntry({ column: 1 });
  const right = makeEntry({ column: 8 });
  const result = dedupeEntries([left, right]);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(getEntrySignature(left), getEntrySignature(right));
});

test("removeDuplicateEntries filters by signature", () => {
  const local = [makeEntry({ sourceKind: "inline", filePath: "/project/App.vue", line: 10 })];
  const global = [makeEntry({ sourceKind: "inline", filePath: "/project/App.vue", line: 10 }), makeEntry({ selector: ".btn.primary", declarations: "color: blue;" })];
  const filtered = removeDuplicateEntries(global, local);
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].selector, ".btn.primary");
});

test("sortEntriesByPriority orders inline > imported > global", () => {
  const entries = [
    makeEntry({ sourceKind: "global", line: 3 }),
    makeEntry({ sourceKind: "inline", line: 1 }),
    makeEntry({ sourceKind: "imported", line: 2 })
  ];
  const sorted = sortEntriesByPriority(entries);
  assert.deepStrictEqual(
    sorted.map((entry) => entry.sourceKind),
    ["inline", "imported", "global"]
  );
});

test("mergeEntries dedupes across sources", () => {
  const merged = mergeEntries([makeEntry({ column: 1 })], [makeEntry({ column: 9 })]);
  assert.strictEqual(merged.length, 1);
});

test("extractStyleDependencies keeps extensionless sass imports and skips builtins", () => {
  const source = `
    @use "sass:math";
    @use "variables";
    @forward "../mixins/index";
    @import url("https://cdn.example.com/x.css");
    @import "./buttons.scss";
    @import "pkg:somewhere";
  `;
  const deps = extractStyleDependencies(source);
  assert.ok(deps.includes("variables"));
  assert.ok(deps.includes("../mixins/index"));
  assert.ok(deps.includes("./buttons.scss"));
  assert.ok(!deps.includes("sass:math"));
  assert.ok(!deps.some((item) => item.startsWith("http")));
  assert.ok(!deps.includes("pkg:somewhere"));
});

test("filterEntriesForElement prefers direct class over ancestor context", () => {
  const entries = [
    makeEntry({ selector: ".PrintPreview_div .btn", line: 1 }),
    makeEntry({ selector: ".btn", line: 2, declarations: "display: flex;" })
  ];
  const filtered = filterEntriesForElement("btn", entries, ["btn"]);
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].selector, ".btn");
});

test("filterEntriesForElement keeps compound class when all classes present", () => {
  const entries = [
    makeEntry({ selector: ".btn.primary", declarations: "color: blue;" }),
    makeEntry({ selector: ".btn", declarations: "color: red;" })
  ];
  const filtered = filterEntriesForElement("btn", entries, ["btn", "primary"]);
  assert.ok(filtered.some((entry) => entry.selector === ".btn"));
  assert.ok(filtered.some((entry) => entry.selector === ".btn.primary"));
});

(async () => {
  await testAsync("parseCssEntries reads plain css class rules", async () => {
    const filePath = path.join("/tmp", "sample.css");
    const entries = await parseCssEntries(".hero { color: #111; }\n.hero.title { font-weight: 700; }", filePath, {
      sourceKind: "global"
    });
    const names = entries.map((entry) => entry.className).sort();
    assert.deepStrictEqual(names, ["hero", "hero", "title"]);
    assert.ok(entries.every((entry) => entry.sourceKind === "global"));
  });

  await testAsync("parseCssEntries compiles scss @each generated classes", async () => {
    const filePath = path.join("/tmp", "colors.scss");
    const source = `
      $colors: (primary, danger);
      @each $name in $colors {
        .text-#{$name} { color: black; }
      }
    `;
    const entries = await parseCssEntries(source, filePath, { sourceKind: "global" });
    const names = new Set(entries.map((entry) => entry.className));
    assert.ok(names.has("text-primary"), `missing text-primary in ${Array.from(names)}`);
    assert.ok(names.has("text-danger"), `missing text-danger in ${Array.from(names)}`);
  });

  if (process.exitCode) {
    console.error("\nSome tests failed.");
    process.exit(process.exitCode);
  }

  console.log(`\n${passed} tests passed.`);
})();
