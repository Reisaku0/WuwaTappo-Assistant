import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { textOf, mentionsPet, extractCodes, merge } from '../scripts/find-codes.mjs';

// 照官方「重点迭代规划同步」帖子的写法
const post = [
  { type: 'paragraph', children: [{ text: '为了感谢漂泊者们自Wuwa Tappo上线以来给予的喜爱与支持，我们也准备了一份特别兑换码：' }] },
  { type: 'paragraph', children: [{ text: '🎁 兑换码：RareTappo' }] },
  { type: 'paragraph', children: [{ text: '✦ 兑换奖励： 随机 Rare 稀有度（紫色）角色 ×1' }] },
  { type: 'paragraph', children: [{ text: '✦ 兑换有效期：自本公告发布之日起至2026年11月13日 11:00（UTC+8）' }] },
];

test('官方帖子里的兑换码和到期时间都能读出来', () => {
  const text = textOf(post);
  assert.ok(mentionsPet(text));
  assert.deepEqual(extractCodes(text), [{ code: 'RareTappo', expires: '2026-11-13T11:00:00+08:00' }]);
});

test('没写到期的码算长期有效；话题标签不算兑换码', () => {
  assert.deepEqual(extractCodes('#WuwaTappo 兑换码：WuwaTappo，永久有效'), [{ code: 'WuwaTappo', expires: null }]);
  assert.deepEqual(extractCodes('#鸣潮 #WuwaTappo 桌宠上线啦'), []);
});

test('并进清单：新码加进去，已有的不动，过期的不收，过期太久的拿掉', () => {
  const now = new Date('2026-12-20T00:00:00Z');
  const list = { version: 1, updated: '2026-11-27', codes: [
    { code: 'WuwaTappo', note: '长期兑换码', expires: null },
    { code: 'OldOne', note: '', expires: '2026-11-01T11:00:00+08:00' },
  ] };
  const { list: next, added, changed } = merge(list, [
    { code: 'wuwatappo', expires: null },
    { code: 'Winter2026', expires: '2027-01-05T11:00:00+08:00', note: '冬季活动', source: 'https://www.taptap.cn/moment/1' },
    { code: 'Gone', expires: '2026-12-01T11:00:00+08:00' },
  ], now);
  assert.ok(changed);
  assert.deepEqual(added, ['Winter2026']);
  assert.deepEqual(next.codes.map(item => item.code), ['WuwaTappo', 'Winter2026']);
  assert.equal(next.updated, '2026-12-20');
  assert.equal(merge(next, [], now).changed, false);
});

test('仓库里的清单格式正确', () => {
  const list = JSON.parse(fs.readFileSync(new URL('../redeem-codes.json', import.meta.url), 'utf8'));
  assert.equal(list.version, 1);
  assert.ok(Array.isArray(list.codes) && list.codes.length <= 100);
  for (const item of list.codes) {
    assert.match(item.code, /^[A-Za-z0-9_-]{3,32}$/);
    assert.ok(item.expires === null || !Number.isNaN(new Date(item.expires).getTime()), item.code + ' 的到期时间读不懂');
  }
});
