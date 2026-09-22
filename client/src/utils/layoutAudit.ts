/**
 * Layout audit — detects horizontal overflow and overlapping interactive elements.
 * Exposed on window as __layoutAudit() in dev; run it per page/viewport from the
 * preview driver and fix anything it reports.
 */
export function layoutAudit(): {
  viewport: { w: number; h: number };
  horizontalOverflow: boolean;
  overflowSources: string[];
  overlaps: { a: string; b: string }[];
} {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 1. Horizontal overflow: any element wider than the viewport
  const overflowSources: string[] = [];
  document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
      // Ignore hidden elements and hidden-subtree elements
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || el.offsetParent === null) return;
      const desc = `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')}`;
      if (!overflowSources.includes(desc)) overflowSources.push(desc);
    }
  });

  // 2. Overlap of interactive elements from different subtrees
  const interactive = [...document.querySelectorAll<HTMLElement>('button, a, input, select, textarea')].filter(
    (el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // offsetParent === null also excludes elements hidden by an ANCESTOR's display:none
      return r.width > 4 && r.height > 4 && style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none' && el.offsetParent !== null;
    },
  );

  /**
   * Trailing adornment: a control deliberately layered OVER the field it
   * belongs to (the show/hide eye inside a password input). The wrapper is
   * `relative`, the control is `absolute`, and the field reserves a gutter for
   * it via its own padding-right — that is a design, not a collision.
   *
   * Without this rule the auditor flagged the same two benign pairs on every
   * page containing a password field, and a noisy auditor is an ignored one:
   * the Settings page reported 2 "overlaps" while a genuinely clipped Filters
   * button on /matches looked like more of the same noise.
   */
  const isAdornment = (control: HTMLElement, host: HTMLElement): boolean => {
    if (!control.parentElement || control.parentElement !== host.parentElement) return false;
    if (getComputedStyle(control).position !== 'absolute') return false;
    const wrapperPos = getComputedStyle(host.parentElement).position;
    if (wrapperPos !== 'relative' && wrapperPos !== 'absolute') return false;
    // The host must genuinely reserve the space the control sits in.
    const hostRect = host.getBoundingClientRect();
    const controlRect = control.getBoundingClientRect();
    const reserved = parseFloat(getComputedStyle(host).paddingRight) || 0;
    return reserved > 0 && hostRect.right - controlRect.left <= reserved + 2;
  };

  const overlaps: { a: string; b: string }[] = [];
  for (let i = 0; i < interactive.length; i++) {
    for (let j = i + 1; j < interactive.length; j++) {
      const a = interactive[i];
      const b = interactive[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (isAdornment(a, b) || isAdornment(b, a)) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const x = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
      const y = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
      if (x > 8 && y > 8) {
        // A fixed bar (topbar/nav) with content scrolling beneath it is normal.
        // Only fixed-vs-fixed or in-flow-vs-in-flow overlaps are real bugs.
        const inFixed = (el: HTMLElement): boolean => {
          let cur: HTMLElement | null = el;
          while (cur && cur !== document.body) {
            if (getComputedStyle(cur).position === 'fixed') return true;
            cur = cur.parentElement;
          }
          return false;
        };
        if (inFixed(a) !== inFixed(b)) continue;
        const desc = (el: HTMLElement) => `${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 18) || (el as HTMLInputElement).placeholder || ''}`;
        overlaps.push({ a: desc(a), b: desc(b) });
        if (overlaps.length > 10) return { viewport: { w: vw, h: vh }, horizontalOverflow: overflowSources.length > 0, overflowSources, overlaps };
      }
    }
  }

  return {
    viewport: { w: vw, h: vh },
    horizontalOverflow: overflowSources.length > 0,
    overflowSources: overflowSources.slice(0, 8),
    overlaps: overlaps.slice(0, 8),
  };
}

if (import.meta.env.DEV) {
  (window as any).__layoutAudit = layoutAudit;
}
