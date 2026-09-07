import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Exercise the actual emitted click binding with both consumers of
// data-community: a picker button and the nested post-search section.
test("search panel clicks do not acquire community navigation", () => {
  const source = readFileSync(
    new URL("../reddit-research-studio.mjs", import.meta.url),
    "utf8",
  );
  const binding = source.match(
    /document\.querySelectorAll\('([^']*data-community[^']*)'\)\.forEach\(button=>button\.addEventListener\('click',\(\)=>navigate\(button\.dataset\.community,CURRENT_PERIOD\)\)\);/,
  );
  assert.ok(binding, "community click binding must remain testable");
  const navigations = [];
  const node = (tag) => ({
    tag,
    dataset: { community: "AI_Agents" },
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
  });
  const picker = node("button");
  const search = node("section");
  vm.runInNewContext(binding[0], {
    document: {
      querySelectorAll(selector) {
        return [picker, search].filter(
          (item) => !selector.startsWith("button") || item.tag === "button",
        );
      },
    },
    CURRENT_PERIOD: "all",
    navigate: (...args) => navigations.push(args),
  });
  assert.equal(
    search.listeners.click,
    undefined,
    "clicks bubbling through search must not navigate",
  );
  picker.listeners.click();
  assert.deepEqual(navigations, [["AI_Agents", "all"]]);
});
