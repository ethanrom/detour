// Selectors: data-detour-id attribute selectors and unique structural CSS paths.

export function attrSelector(attr: string, value: string): string {
  return `[${attr}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

/** Unique path such as `body > div:nth-of-type(2) > a:nth-of-type(3)`. */
export function cssPath(el: Element, body: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== body && cur.localName !== "html") {
    const tag = cur.localName;
    let n = 1;
    for (let s = cur.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === tag) n++;
    parts.unshift(`${tag}:nth-of-type(${n})`);
    cur = cur.parentElement;
  }
  parts.unshift("body");
  return parts.join(" > ");
}
