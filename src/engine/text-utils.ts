/**
 * 文本规范化与模糊匹配工具（零第三方依赖）
 */

/** 全角字符转半角（ASCII 区，含全角空格 U+3000） */
export function toHalfWidth(s: string): string {
  return s.replace(/[！-～　]/g, (ch) => {
    if (ch === '　') return ' ';
    return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
  });
}

/** 去除所有空白（含全角空格、制表符、换行） */
export function removeSpaces(s: string): string {
  return s.replace(/[\s 　]+/g, '');
}

/** 去掉括号及括号内内容：圆括号/方括号/【】/书名号 等 */
export function stripParenthetical(s: string): string {
  return s
    .replace(/[（(【\[《][^（）()【】\[\]《》]*[）)】\]》]/g, '')
    .trim();
}

/** 提取字符串中所有括号内文本 */
export function extractParenthetical(s: string): string[] {
  const out: string[] = [];
  const re = /[（(【\[《]([^（）()【】\[\]《》]*)[）)】\]》]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[1].trim());
  return out;
}

/**
 * 规范化指标/标签文本，用于映射比对：
 * 全角转半角 -> 去空白 -> 去括号内容 -> 去常见标点
 */
export function normalizeText(s: string): string {
  let t = toHalfWidth(s);
  t = removeSpaces(t);
  t = stripParenthetical(t);
  t = t.replace(/[，,。.、：:；;！!？?“”"'’‘\-—_]/g, '');
  return t;
}

/** 仅做轻量规范化（保留括号，用于单位提取等场景） */
export function lightNormalize(s: string): string {
  return removeSpaces(toHalfWidth(s)).trim();
}

/**
 * 经典 Levenshtein 编辑距离
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

/** 相似度 0~1：1 - 编辑距离/较长串长度 */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** 子串包含加分：处理"农业产值" vs "农业总产值"这类长短互含 */
export function containmentScore(short: string, long: string): number {
  if (!short || !long) return 0;
  if (long.includes(short)) {
    // 短串占长串比例越高越好，基础 0.85
    return 0.85 + 0.12 * (short.length / long.length);
  }
  if (short.includes(long)) {
    return 0.85 + 0.12 * (long.length / short.length);
  }
  return 0;
}

/**
 * 综合匹配分：取编辑距离相似度与包含分的较大值
 */
export function matchScore(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return 1;
  return Math.max(similarity(na, nb), containmentScore(na, nb));
}

/** 判断文本是否为纯空白或 null */
export function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'number') return false;
  return removeSpaces(toHalfWidth(String(v))).length === 0;
}

/** 安全取字符串 */
export function asText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}
