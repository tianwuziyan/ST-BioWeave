import test from 'node:test';
import assert from 'node:assert/strict';
import {
  _CN_FESTIVAL_ALIAS,
  _CN_MONTH_ALIAS,
  _cnToNumber,
  extractDayFromTime,
  normalizeCnDateDigits,
  parseCnDate,
} from '../utils/cn-date.js';

const monthAliases = {
  1: ['正月', '孟春', '初春', '早春', '上春', '端春', '端月', '征月', '初月', '泰月', '杨月', '寅月', '孟阳', '春阳', '初阳', '首阳', '新正', '月正', '开岁', '献岁', '芳岁', '华岁', '岁岁'],
  2: ['仲春', '中春', '甜春', '正春', '仲阳', '如月', '杏月', '丽月', '令月', '卯月', '花朝', '竹秋'],
  3: ['季春', '暮春', '晚春', '末春', '嘉月', '蚕月', '花月', '桃月', '桃浪'],
  4: ['初夏', '首夏', '孟夏', '维夏', '槐夏', '仲月', '梅月', '阴月', '乏月', '麦月', '余月', '巳月', '槐月', '清和月', '中吕', '麦候', '麦秋'],
  5: ['仲夏', '中夏', '榴月', '蒲月', '午月', '皋月', '天中', '端阳'],
  6: ['季夏', '晚夏', '暮夏', '暑月', '季月', '荷月', '伏月'],
  7: ['首秋', '早秋', '新秋', '初秋', '孟秋', '上秋', '兰秋', '申月', '兰月', '巧月', '相月', '霜月'],
  8: ['仲秋', '正秋', '桂月', '壮月', '酉月', '获月', '仲商', '南吕'],
  9: ['暮秋', '晚秋', '季秋', '凉秋', '菊月', '戌月', '玄月', '秋白', '霜序', '暮商', '季商'],
  10: ['初冬', '孟冬', '上冬', '开冬', '吉月', '良月', '坤月', '阳月', '小阳春', '亥月', '应钟'],
  11: ['仲冬', '中冬', '子月', '辜月', '龙潜月', '葭月', '畅月', '黄钟'],
  12: ['严冬', '季冬', '残冬', '末冬', '暮冬', '穷冬', '腊冬', '严月', '腊月', '冰月', '大吕'],
};

const festivalAliases = {
  '1-1': ['正朝', '三朝', '元春', '元旦', '元日', '无朔', '元正'],
  '1-7': ['人日', '人曰'],
  '1-15': ['元宵', '元夕', '元夜', '上元', '灯节'],
  '2-1': ['中和日'],
  '3-3': ['重三', '上巳', '三巳', '上除', '令节'],
  '4-8': ['浴佛日'],
  '4-19': ['浣花日'],
  '5-5': ['端午', '端午节', '蒲节', '午日'],
  '6-6': ['天贶节'],
  '7-7': ['七夕', '星节', '乞巧节'],
  '7-15': ['中元', '中元节'],
  '8-15': ['中秋', '中秋节', '仲秋节'],
  '9-9': ['重阳', '重阳节', '菊花节', '重九'],
  '10-15': ['下元', '下元节'],
  '12-30': ['除夕', '守岁'],
};

test('SevenDaysCal Chinese number conversion and digit normalization are preserved', () => {
  assert.equal(normalizeCnDateDigits('２０２４年０３月１５日'), '2024年03月15日');
  assert.deepEqual(
    ['元', '十', '十一', '二十', '廿三', '卄九', '卅一', '壹拾贰', '仟贰'].map(_cnToNumber),
    [1, 10, 11, 20, 23, 29, 31, 12, 1002],
  );
  assert.equal(_cnToNumber('二〇二四'), null);
  assert.equal(_cnToNumber('第三'), null);
});

test('SevenDaysCal day-key extraction keeps its branch priority and aliases feed the same key flow', () => {
  assert.equal(extractDayFromTime('2024年3月15日'), '2024-3-15');
  assert.equal(extractDayFromTime('2024/03/19'), '2024-3-19');
  assert.equal(extractDayFromTime('2024-03-19'), '2024-3-19');
  assert.equal(extractDayFromTime('2024.03.19'), '2024-3-19');
  assert.equal(extractDayFromTime('第 3 天'), 'day-3');
  assert.equal(extractDayFromTime('day 4'), 'day-4');
  assert.equal(extractDayFromTime('十二年三月十八日'), 'cn-12-3-18');
  assert.equal(extractDayFromTime('元年正月初一'), 'cn-1-1-1');
  assert.equal(extractDayFromTime('霜月初七'), 'cn-0-7-7');
  assert.equal(extractDayFromTime('中秋节'), 'cn-0-8-15');
});

test('every requested traditional month alias maps through the common longest-token parser', () => {
  for (const [month, aliases] of Object.entries(monthAliases)) {
    for (const alias of aliases) {
      assert.equal(_CN_MONTH_ALIAS[alias], Number(month), `missing month alias: ${alias}`);
      assert.deepEqual(parseCnDate(`${alias}初一`), {month: Number(month), day: 1}, alias);
    }
  }
  assert.equal(_CN_MONTH_ALIAS.正, 1);
  assert.equal(_CN_MONTH_ALIAS.冬, 11);
  assert.equal(_CN_MONTH_ALIAS.腊, 12);
  assert.equal(_CN_MONTH_ALIAS.臘, 12);
});

test('every requested traditional festival alias maps to its fixed month and day', () => {
  for (const [date, aliases] of Object.entries(festivalAliases)) {
    const [month, day] = date.split('-').map(Number);
    for (const alias of aliases) {
      assert.deepEqual(_CN_FESTIVAL_ALIAS[alias], {month, day}, `missing festival alias: ${alias}`);
      assert.deepEqual(parseCnDate(alias), {month, day}, alias);
    }
  }
});

test('month and festival aliases use longest matching tokens', () => {
  assert.deepEqual(parseCnDate('甲月初一', {
    monthAlias: {甲: 1, 甲月: 2},
  }), {month: 2, day: 1});
  assert.deepEqual(parseCnDate('甲节', {
    festivalAlias: {甲: {month: 1, day: 1}, 甲节: {month: 2, day: 2}},
  }), {month: 2, day: 2});
});

test('Chinese dates, open era names, festivals, and invalid dates follow the shared parser', () => {
  assert.deepEqual(parseCnDate('十二年三月十八日'), {month: 3, day: 18, year: 12});
  assert.deepEqual(parseCnDate('赤曜历十二年霜月初七'), {month: 7, day: 7, year: 12, eraLabel: '赤曜历'});
  assert.deepEqual(parseCnDate('天河四十二年春，三月十八'), {month: 3, day: 18, year: 42, eraLabel: '天河'});
  assert.deepEqual(parseCnDate('某任意纪年十九年中秋节'), {month: 8, day: 15, year: 19, eraLabel: '某任意纪年'});
  assert.deepEqual(parseCnDate('2024年中秋节'), {month: 8, day: 15, year: 2024});
  assert.deepEqual(parseCnDate('2024-02-29'), {month: 2, day: 29, year: 2024});
  assert.equal(parseCnDate('2023年2月29日'), null);
  assert.equal(parseCnDate('2024年2月30日'), null);
  assert.equal(parseCnDate('10000年三月十八日'), null);
  assert.equal(parseCnDate('第三天'), null);
  assert.equal(parseCnDate('未知时间'), null);
});

test('custom calendar formal month names are validated without Gregorian Date', () => {
  const calendar = {
    kind: 'custom',
    id: 'custom-story',
    months: [
      {name: '霜季', days: 20},
      {name: '雨季', days: 25},
    ],
  };
  assert.deepEqual(parseCnDate('星海纪元三年霜季初七', {calendar}), {
    month: 1,
    day: 7,
    year: 3,
    eraLabel: '星海纪元',
  });
  assert.deepEqual(parseCnDate('三年霜季初七', {calendar}), {
    month: 1,
    day: 7,
    year: 3,
  });
  assert.equal(parseCnDate('星海纪元三年霜季廿一', {calendar}), null);
});
