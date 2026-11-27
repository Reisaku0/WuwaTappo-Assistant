// 每两小时由 GitHub Actions 运行：读 TapTap 鸣潮论坛的官方帖子，找出 WuwaTappo 的兑换码，写进 redeem-codes.json。
// 只认《鸣潮》官方账号发的帖子；只收明确属于桌宠的「兑换码：XXX」；每个码只认它自己那一段里的有效期；
// 有效期写了但读不懂的码先不收，并让任务报错（GitHub 会发邮件提醒）；过期超过 30 天的码从清单里拿掉。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FEED = 'https://www.taptap.cn/webapiv2/feed/v7/by-group';
const DETAIL = 'https://www.taptap.cn/webapiv2/moment/v3/detail';
const GROUP_ID = 330015;        // 鸣潮论坛
const OFFICIAL_APP_ID = 234280; // 《鸣潮》官方账号
const X_UA = 'V=1&PN=WebApp&LANG=zh_CN&VN_CODE=102&LOC=CN&PLT=PC&DS=Android&UID=0&OS=Windows&OSV=10&DT=PC';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const CODE = /^[A-Za-z0-9_-]{3,32}$/;
const MAX_CODES = 100;
const KEEP_EXPIRED_DAYS = 30;
const PET = /Wuwa\s*Tappo|鸣潮桌宠|桌宠软件|桌宠/i;
const GAME = /游戏本体|游戏内|鸣潮游戏|《鸣潮》游戏|客户端内|游戏兑换/;
const CODE_LINE = /兑换码\s*[:：]\s*([A-Za-z0-9_-]{3,32})(?![A-Za-z0-9_-])/g;
const VALIDITY = /有效期|截止|截至|到期|可兑换至|兑换至/;

/** 富文本里的所有文字，每段一行。 */
export function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object') {
    // TapTap 的正文是 { json: [段落…] }
    if (Array.isArray(node.json)) return textOf(node.json);
    const own = typeof node.text === 'string' ? node.text : '';
    const inner = node.children ? textOf(node.children) : '';
    return own + inner + (node.type === 'paragraph' ? '\n' : '');
  }
  return '';
}

export function mentionsPet(text) { return PET.test(text); }

/** 一行里写的到期时刻（北京时间）；没写返回 undefined，写了但读不懂返回 null。 */
export function parseUntil(line) {
  if (!VALIDITY.test(line) && !/至\s*\d{4}/.test(line)) return undefined;
  if (/永久|长期有效|不限时/.test(line)) return undefined;
  // 只写了月日、没写年份的，算读不懂，先不收
  if (/至\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(line) && !/\d{4}\s*年\s*\d{1,2}\s*月/.test(line)) return null;
  const m = line.match(/(?:至|截止|截至|到)\s*(?:到)?\s*(\d{4})\s*(?:年|[.\-/])\s*(\d{1,2})\s*(?:月|[.\-/])\s*(\d{1,2})\s*日?(?:\s*(\d{1,2})\s*[:：时]\s*(\d{2})?)?/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${(h || '23').padStart(2, '0')}:${(mi || (h ? '00' : '59')).padStart(2, '0')}:00+08:00`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

// 帖子里分段的小标题：【…】、[…]、一、二、…
const HEADER = /^\s*[【\[［][^】\]］]{1,40}[】\]］]\s*$|^\s*[一二三四五六七八九十]{1,3}\s*[、.．]/;

/**
 * 帖子里属于桌宠的兑换码。帖子标题算作开头那一段，正文按小标题分段，每个码只看自己那一段：
 * - 码那一行写了桌宠就是桌宠的，写了游戏本体就不是；
 * - 否则看这一段：只提到桌宠的算；只提到游戏本体的不算；两个都提到的看不准，先不收；
 *   这一段什么都没提时，帖子标题是桌宠的才算；
 * - 有效期只认这一段里的：没有就长期有效；只有一条就是这一段所有码的；多于一条或读不懂的先不收。
 * 返回 { codes: [{ code, expires }], problems: [文字] }，problems 里是先不收的码和原因。
 */
export function extractCodes(text, title = '') {
  const lines = [title, ...text.split('\n')];
  const blocks = [];
  let current = [];
  lines.forEach((line, index) => {
    if (index > 0 && HEADER.test(line) && current.length) { blocks.push(current); current = []; }
    current.push(line);
  });
  if (current.length) blocks.push(current);
  const titlePet = mentionsPet(title);
  const codes = [], problems = [];
  for (const block of blocks) {
    const blockText = block.join('\n');
    const hits = [];
    block.forEach(line => { for (const m of line.matchAll(CODE_LINE)) if (!hits.some(hit => hit.code === m[1])) hits.push({ code: m[1], line }); });
    if (!hits.length) continue;
    const until = block.map(parseUntil).filter(value => value !== undefined);
    for (const hit of hits) {
      if (codes.some(item => item.code === hit.code)) continue;
      let forPet;
      if (mentionsPet(hit.line) && !GAME.test(hit.line)) forPet = true;
      else if (GAME.test(hit.line)) forPet = false;
      else if (mentionsPet(blockText) && GAME.test(blockText)) { problems.push(`${hit.code}：这一段同时提到桌宠和游戏本体，看不出是哪边的码`); continue; }
      else if (GAME.test(blockText)) forPet = false;
      else forPet = mentionsPet(blockText) || titlePet;
      if (!forPet) continue;
      if (until.includes(null)) { problems.push(`${hit.code}：有效期的写法读不懂`); continue; }
      if (until.length > 1) { problems.push(`${hit.code}：这一段有多条有效期，看不出这个码是哪一条`); continue; }
      codes.push({ code: hit.code, expires: until.length ? until[0] : null });
    }
  }
  return { codes, problems };
}

/** 把找到的码并进清单：新码加进去；同一个帖子更正（延长）有效期时跟着改；过期超过 30 天的拿掉。 */
export function merge(list, found, now = new Date()) {
  const codes = Array.isArray(list.codes) ? list.codes.map(item => ({ ...item })) : [];
  const added = [];
  let changed = false;
  for (const item of found) {
    if (!CODE.test(item.code)) continue;
    const existing = codes.find(entry => String(entry.code).toLowerCase() === item.code.toLowerCase());
    if (existing) {
      if (item.source && existing.source === item.source && existing.expires !== item.expires && item.expires && (!existing.expires || item.expires > existing.expires)) {
        existing.expires = item.expires; changed = true;
      }
      continue;
    }
    if (item.expires && new Date(item.expires) <= now) continue;
    if (codes.length >= MAX_CODES) continue;
    codes.push({ code: item.code, note: item.note || '', expires: item.expires, source: item.source || '' });
    added.push(item.code);
    changed = true;
  }
  const cutoff = now.getTime() - KEEP_EXPIRED_DAYS * 86400000;
  const kept = codes.filter(entry => !entry.expires || new Date(entry.expires).getTime() > cutoff);
  if (kept.length !== codes.length) changed = true;
  return { list: changed ? { ...list, version: 1, updated: now.toISOString().slice(0, 10), codes: kept } : list, added, changed };
}

/** 清单能被助手读：版本 1、最多 100 个码、码和有效期格式都对。 */
export function validate(list) {
  if (!list || list.version !== 1 || !Array.isArray(list.codes)) throw new Error('清单格式不对');
  if (list.codes.length > MAX_CODES) throw new Error('清单超过 100 个码');
  for (const item of list.codes) {
    if (!CODE.test(item.code)) throw new Error(`码的格式不对：${item.code}`);
    if (item.expires !== null && Number.isNaN(new Date(item.expires).getTime())) throw new Error(`有效期读不懂：${item.code}`);
  }
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
  // TapTap 一页最多 10 篇：读最近两页，20 篇官方帖子
  const posts = [];
  for (const from of [0, 10]) {
    const feed = await getJson(FEED, { group_id: GROUP_ID, type: 'official', limit: 10, from });
    if (!Array.isArray(feed?.data?.list)) throw new Error('TapTap 返回的帖子列表格式变了');
    posts.push(...feed.data.list);
  }
  const found = [], problems = [];
  for (const entry of posts) {
    const moment = entry.moment || entry;
    if (!moment?.is_official || moment?.author?.app?.id !== OFFICIAL_APP_ID) continue;
    let detail;
    // 某一篇打不开（删了、维护中）就记下来跳过，不耽误其他帖子
    try { detail = await getJson(DETAIL, { id: moment.id_str }); }
    catch (error) { problems.push(`帖子读不了：${moment.id_str}（${error.message}）`); continue; }
    const title = detail?.data?.moment?.topic?.title || moment?.topic?.title || '';
    const text = textOf(detail?.data?.first_post?.contents);
    if (!mentionsPet(`${title}\n${text}`)) continue;
    const source = `https://www.taptap.cn/moment/${moment.id_str}`;
    const result = extractCodes(text, title);
    result.codes.forEach(item => found.push({ ...item, note: title, source }));
    result.problems.forEach(problem => problems.push(`${problem}（${source}）`));
  }
  const { list: next, added, changed } = merge(list, found);
  validate(next);
  if (changed) fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  console.log(added.length ? `收录新兑换码：${added.join('、')}` : '没有新的兑换码');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `added=${added.join(',')}\n`);
  if (problems.length) {
    // 先不收这些码，让任务显示失败，好让维护者看一眼
    console.error('有码暂缓收录：\n' + problems.join('\n'));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1); });
}
