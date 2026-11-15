/** 极简 DOM 创建辅助 */
export function el(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

let toastTimer: number | undefined;
export function toast(msg: string): void {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const t = el('div', { className: 'toast' }, msg);
  document.body.append(t);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 2600);
}
