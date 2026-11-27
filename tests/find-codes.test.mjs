import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { textOf, mentionsPet, extractCodes, parseUntil, merge, validate } from '../scripts/find-codes.mjs';

const para = text => ({ type: 'paragraph', children: [{ text }] });
const TITLE = '《鸣潮》桌宠软件 Wuwa Tappo 重点迭代规划同步';

// 照官方「重点迭代规划同步」帖子的写法
const post = [
  para('为了感谢漂泊者们自Wuwa Tappo上线以来给予的喜爱与支持，我们也准备了一份特别兑换码：'),
  para('🎁 兑换码：RareTappo'),
  para('✦ 兑换奖励： 随机 Rare 稀有度（紫色）角色 ×1'),
  para('✦ 兑换有效期：自本公告发布之日起至2026年11月13日 11:00（UTC+8）'),
];

test('官方帖子里的兑换码和到期时间都能读出来', () => {
  // TapTap 帖子详情里正文就是这样包着的
  const text = textOf({ json: post });
  assert.ok(mentionsPet(text));
  assert.deepEqual(extractCodes(text, TITLE), { codes: [{ code: 'RareTappo', expires: '2026-11-13T11:00:00+08:00' }], problems: [] });
});

test('同一帖里游戏本体的码不收，只收桌宠的码', () => {
  const text = textOf([
    para('【游戏本体福利】'), para('游戏本体兑换码：GameOnly'), para('兑换有效期：至2026年12月31日 23:59'),
    para(''), para(''), para(''),
    para('【Wuwa Tappo 福利】'), para('兑换码：PetOnly'), para('兑换有效期：至2027年1月5日 11:00'),
  ]);
  assert.deepEqual(extractCodes(text, '鸣潮新版本前瞻').codes, [{ code: 'PetOnly', expires: '2027-01-05T11:00:00+08:00' }]);
});

test('桌宠的码在前、游戏本体的码在后，也按小标题分清', () => {
  const text = textOf([para('【Wuwa Tappo 福利】'), para('兑换码：PetOnly'), para('【游戏本体福利】'), para('兑换码：GameOnly')]);
  assert.deepEqual(extractCodes(text, '福利汇总').codes, [{ code: 'PetOnly', expires: null }]);
});

test('每个码用自己那一段的有效期；有效期写在码前面也一样', () => {
  const text = textOf([
    para('【桌宠活动一】'), para('有效期至2026年12月31日 11:00'), para('Wuwa Tappo 兑换码：AAA111'),
    para('【桌宠活动二】'), para('有效期至2026年11月28日 11:00'), para('Wuwa Tappo 兑换码：BBB222'),
  ]);
  assert.deepEqual(extractCodes(text, TITLE).codes, [
    { code: 'AAA111', expires: '2026-12-31T11:00:00+08:00' },
    { code: 'BBB222', expires: '2026-11-28T11:00:00+08:00' },
  ]);
});

test('一段里有多个码和多条有效期、看不出对应关系时，先不收', () => {
  const result = extractCodes(textOf([
    para('Wuwa Tappo 兑换码：AAA111'), para('有效期至2026年11月28日 11:00'),
    para('Wuwa Tappo 兑换码：BBB222'), para('有效期至2026年12月31日 11:00'),
  ]), TITLE);
  assert.deepEqual(result.codes, []);
  assert.equal(result.problems.length, 2);
});

test('只写在标题里的码也收', () => {
  const result = extractCodes(textOf([para('兑换有效期：至2027年1月5日 11:00')]), 'Wuwa Tappo 福利，兑换码：PetOnly');
  assert.deepEqual(result.codes, [{ code: 'PetOnly', expires: '2027-01-05T11:00:00+08:00' }]);
});

test('「可兑换至11月26日」这种没写年份的，先不收', () => {
  const result = extractCodes(textOf([para('Wuwa Tappo 兑换码：Short1'), para('可兑换至11月26日 11:00')]), TITLE);
  assert.deepEqual(result.codes, []);
  assert.equal(result.problems.length, 1);
});

test('有效期的常见写法都认得；写了但读不懂的先不收', () => {
  assert.equal(parseUntil('有效期至 2026.11.26 11:00'), '2026-11-26T11:00:00+08:00');
  assert.equal(parseUntil('截止 2026-11-26'), '2026-11-26T23:59:00+08:00');
  assert.equal(parseUntil('永久有效'), undefined);
  const odd = extractCodes(textOf([para('Wuwa Tappo 兑换码：Strange1'), para('有效期：本周末结束')]), TITLE);
  assert.deepEqual(odd.codes, []);
  assert.equal(odd.problems.length, 1);
});

test('没写到期的码算长期有效；话题标签不算兑换码', () => {
  assert.deepEqual(extractCodes('#WuwaTappo 兑换码：WuwaTappo，永久有效', TITLE).codes, [{ code: 'WuwaTappo', expires: null }]);
  assert.deepEqual(extractCodes('#鸣潮 #WuwaTappo 桌宠上线啦', TITLE).codes, []);
});

test('并进清单：新码加进去，已有的不动，同一帖延期跟着改，过期的不收，过期太久的拿掉', () => {
  const now = new Date('2026-12-20T00:00:00Z');
  const list = { version: 1, updated: '2026-11-27', codes: [
    { code: 'WuwaTappo', note: '长期兑换码', expires: null },
    { code: 'OldOne', note: '', expires: '2026-11-01T11:00:00+08:00' },
    { code: 'Extend1', note: '', expires: '2026-12-25T11:00:00+08:00', source: 'https://www.taptap.cn/moment/9' },
  ] };
  const { list: next, added, changed } = merge(list, [
    { code: 'wuwatappo', expires: null },
    { code: 'Winter2026', expires: '2027-01-05T11:00:00+08:00', note: '冬季活动', source: 'https://www.taptap.cn/moment/1' },
    { code: 'Gone', expires: '2026-12-01T11:00:00+08:00' },
    { code: 'Extend1', expires: '2027-01-10T11:00:00+08:00', source: 'https://www.taptap.cn/moment/9' },
  ], now);
  assert.ok(changed);
  assert.deepEqual(added, ['Winter2026']);
  assert.deepEqual(next.codes.map(item => item.code), ['WuwaTappo', 'Extend1', 'Winter2026']);
  assert.equal(next.codes[1].expires, '2027-01-10T11:00:00+08:00');
  assert.equal(merge(next, [], now).changed, false);
});

test('仓库里的清单格式正确', () => {
  validate(JSON.parse(fs.readFileSync(new URL('../redeem-codes.json', import.meta.url), 'utf8')));
  assert.throws(() => validate({ version: 1, codes: Array.from({ length: 101 }, (_, i) => ({ code: 'Code' + i, expires: null })) }));
});
