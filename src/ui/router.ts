/** 页面路由状态（独立模块，避免 main↔pages 循环依赖） */
export type PageId = 'import' | 'inspect' | 'mapping' | 'preview' | 'summary';

let page: PageId = 'import';
const listeners = new Set<() => void>();

export function getPage(): PageId {
  return page;
}
export function setPage(p: PageId): void {
  page = p;
  listeners.forEach((fn) => fn());
}
export function onPageChange(fn: () => void): void {
  listeners.add(fn);
}
