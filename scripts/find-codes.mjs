// 每两小时由 GitHub Actions 运行：读 TapTap 鸣潮论坛的官方帖子，找出 WuwaTappo 的兑换码，写进 redeem-codes.json。
// 只认《鸣潮》官方账号发的帖子，只收「兑换码：XXX」这种写法；过期超过 30 天的码从清单里拿掉。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FEED = 'https://www.taptap.cn/webapiv2/feed/v7/by-group';
const DETAIL = 'https://www.taptap.cn/webapiv2/moment/v3/detail';
const GROUP_ID = 330015;      // 鸣潮论坛
const OFFICIAL_APP_ID = 234280; // 《鸣潮》官方账号
const X_UA = 'V=1&PN=WebApp&LANG=zh_CN&VN_CODE=102&LOC=CN&PLT=PC&DS=Android&UID=0&OS=Windows&OSV=10&DT=PC';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const CODE = /^[A-Za-z0-9_-]{3,32}$/;
const KEEP_EXPIRED_DAYS = 30;

/** 富文本里的所有文字，每段一行。 */
export function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object') {
    const own = typeof node.text === 'string' ? node.text : '';
    const inner = node.children ? textOf(node.children) : '';
    return own + inner + (node.type === 'paragraph' ? '\n' : '');
  }
  return '';
}

export function mentionsPet(text) { return /Wuwa\s*Tappo|鸣潮桌宠|桌宠软件/i.test(text); }

/** 「兑换码：XXX」和「有效期……至2026年11月13日 11:00」；没写到期就当长期有效。 */
export function extractCodes(text) {
  const codes = [];
  for (const match of text.matchAll(/兑换码\s*[:：]\s*([A-Za-z0-9_-]{3,32})(?![A-Za-z0-9_-])/g)) {
    if (!codes.includes(match[1])) codes.push(match[1]);
  }
  const until = text.match(/有效期[^\n]*?至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2})\s*[:：]\s*(\d{2}))?/);
  const expires = until
    ? `${until[1]}-${until[2].padStart(2, '0')}-${until[3].padStart(2, '0')}T${(until[4] || '23').padStart(2, '0')}:${until[5] || '59'}:00+08:00`
    : null;
  return codes.map(code => ({ code, expires }));
}

/** 把找到的码并进清单：已有的不改；过期超过 30 天的拿掉。返回新清单和新加的码。 */
export function merge(list, found, now = new Date()) {
  const codes = Array.isArray(list.codes) ? list.codes.slice() : [];
  const added = [];
  for (const item of found) {
    if (!CODE.test(item.code)) continue;
    if (codes.some(existing => String(existing.code).toLowerCase() === item.code.toLowerCase())) continue;
    if (item.expires && new Date(item.expires) <= now) continue;
    codes.push({ code: item.code, note: item.note || '', expires: item.expires, source: item.source || '' });
    added.push(item.code);
  }
  const cutoff = now.getTime() - KEEP_EXPIRED_DAYS * 86400000;
  const kept = codes.filter(entry => !entry.expires || new Date(entry.expires).getTime() > cutoff);
  const changed = added.length > 0 || kept.length !== codes.length;
  const day = now.toISOString().slice(0, 10);
  return { list: changed ? { ...list, version: 1, updated: day, codes: kept } : list, added, changed };
}

async function getJson(url, params) {
  const query = new URLSearchParams({ ...params, 'X-UA': X_UA });
  const response = await fetch(`${url}?${query}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

async function main() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'redeem-codes.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const feed = await getJson(FEED, { group_id: GROUP_ID, type: 'official', limit: 20 });
  const found = [];
  for (const entry of feed?.data?.list || []) {
    const moment = entry.moment || entry;
    if (!moment?.is_official || moment?.author?.app?.id !== OFFICIAL_APP_ID) continue;
    const preview = `${moment?.topic?.title || ''}\n${moment?.topic?.summary || ''}`;
    if (!mentionsPet(preview) && !/兑换码/.test(preview)) continue;
    const detail = await getJson(DETAIL, { id: moment.id_str });
    const text = `${detail?.data?.moment?.topic?.title || ''}\n${textOf(detail?.data?.first_post?.contents)}`;
    if (!mentionsPet(text)) continue;
    for (const item of extractCodes(text)) found.push({ ...item, note: moment?.topic?.title || '', source: `https://www.taptap.cn/moment/${moment.id_str}` });
  }
  const { list: next, added, changed } = merge(list, found);
  if (changed) fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  const summary = added.length ? `收录新兑换码：${added.join('、')}` : '没有新的兑换码';
  console.log(summary);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `added=${added.join(',')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1); });
}
