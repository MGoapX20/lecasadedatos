/** Keep existing scene nodes, and therefore their animations, across snapshots. */
export function reconcile(root: Element, html: string): void {
  const template = document.createElement('template');
  template.innerHTML = html;
  patchChildren(root, template.content);
}
function key(n: Node): string | null {
  return n instanceof Element ? n.getAttribute('data-key') : null;
}
function compatible(a: Node, b: Node): boolean {
  return (
    a.nodeType === b.nodeType &&
    (!(a instanceof Element) ||
      (b instanceof Element && a.tagName === b.tagName && key(a) === key(b)))
  );
}
function patchChildren(current: Node, next: Node): void {
  const desired = Array.from(next.childNodes);
  for (let i = 0; i < desired.length; i++) {
    const n = desired[i];
    let old = current.childNodes[i];
    if (!old) {
      current.appendChild(n.cloneNode(true));
      continue;
    }
    if (key(n) && key(old) !== key(n)) {
      const match = Array.from(current.childNodes)
        .slice(i + 1)
        .find((x) => key(x) === key(n) && compatible(x, n));
      if (match) {
        current.insertBefore(match, old);
        old = match;
      }
    }
    if (!compatible(old, n)) {
      current.replaceChild(n.cloneNode(true), old);
      continue;
    }
    if (old.isEqualNode(n)) continue;
    if (old instanceof Element && n instanceof Element) {
      for (const attr of Array.from(old.attributes))
        if (!n.hasAttribute(attr.name)) old.removeAttribute(attr.name);
      for (const attr of Array.from(n.attributes))
        if (old.getAttribute(attr.name) !== attr.value)
          old.setAttribute(attr.name, attr.value);
      patchChildren(old, n);
    } else if (old.nodeValue !== n.nodeValue) old.nodeValue = n.nodeValue;
  }
  while (current.childNodes.length > desired.length)
    current.removeChild(current.lastChild!);
}
