// @vitest-environment jsdom
import { expect, it } from "vitest";
import { extractPage } from "./index";
import { docFrom } from "./testing";

it("extracts a page with a few thousand elements in reasonable time", () => {
  const rows = Array.from({ length: 300 }, (_, i) => `<li class="row"><a href="/p/${i}">Product ${i}</a><span class="price">$${i}</span><button>Add</button></li>`).join("");
  const doc = docFrom(`<style>.row{display:flex} .price{font-weight:700}</style><nav><ul>${rows}</ul></nav><main><h1>Catalog</h1>${rows.replace(/<li/g, "<div").replace(/<\/li>/g, "</div>")}</main>`);
  const t0 = Date.now();
  const p = extractPage(doc);
  const ms = Date.now() - t0;
  expect(p.readingOrder.length).toBeGreaterThan(1500);
  expect(ms).toBeLessThan(15000);
});
