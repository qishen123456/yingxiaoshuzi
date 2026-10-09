import { describe, expect, it } from 'vitest';
import {
  evaluateCondition,
  evaluateRule,
  matchRulesForHouse,
  selectWinningRule,
  type RuleMatchInput,
} from '../src/engine/rule-engine';

/** 与 sql/03_mapping_rule_seed.sql 同构的规则集（id 用演示值）。 */
const RULES: RuleMatchInput[] = [
  {
    id: 1n,
    packageId: 101n,
    priority: 10,
    mutexGroupId: 1n,
    status: 'enabled',
    conditionJson: {
      logic: 'AND',
      conditions: [
        { tag: 'water_tags', op: 'contains_any', value: ['卫生间漏水', '厨房漏水', '阳台漏水', '水管老化'] },
        { tag: 'decorate_status', op: 'in', value: ['5-10年', '未装修'] },
      ],
    },
  },
  {
    id: 2n,
    packageId: 102n,
    priority: 20,
    mutexGroupId: 1n,
    status: 'disabled', // GAP-2 浴改淋
    conditionJson: { logic: 'AND', conditions: [{ tag: 'house_feature_tags', op: 'exists' }] },
  },
  {
    id: 3n,
    packageId: 103n,
    priority: 30,
    mutexGroupId: 1n,
    status: 'enabled',
    conditionJson: {
      logic: 'AND',
      conditions: [
        { tag: 'env_tags', op: 'contains_any', value: ['瓷砖开裂空鼓', '墙面发霉', '渗水/返潮'] },
        { tag: 'family_structure', op: 'in', value: ['A_三代同堂', 'B_多孩之家', 'C_二孩之家', 'D_三口之家'] },
        { tag: 'decorate_status', op: 'in', value: ['5-10年', '未装修'] },
      ],
    },
  },
];

describe('evaluateCondition', () => {
  it('多值标签：数组有交集即命中（含斜杠枚举值「渗水/返潮」）', () => {
    expect(
      evaluateCondition({ tag: 'env_tags', op: 'contains_any', value: ['渗水/返潮'] }, { env_tags: ['渗水/返潮'] }),
    ).toBe(true);
  });

  it('多值标签：空值/缺失恒不命中（防止全量误圈）', () => {
    expect(evaluateCondition({ tag: 'water_tags', op: 'contains_any', value: ['水管老化'] }, {})).toBe(false);
    expect(evaluateCondition({ tag: 'water_tags', op: 'contains_any', value: ['水管老化'] }, { water_tags: [] })).toBe(
      false,
    );
  });

  it('家庭结构带 A_~E_ 前缀，eq/in 必须按真实值匹配', () => {
    expect(
      evaluateCondition({ tag: 'family_structure', op: 'in', value: ['A_三代同堂'] }, { family_structure: 'A_三代同堂' }),
    ).toBe(true);
    expect(
      evaluateCondition({ tag: 'family_structure', op: 'in', value: ['三代同堂'] }, { family_structure: 'A_三代同堂' }),
    ).toBe(false);
  });
});

describe('evaluateRule', () => {
  it('空条件不命中', () => {
    expect(evaluateRule({ logic: 'AND', conditions: [] }, { a: 1 })).toBe(false);
  });

  it('AND 短路：水路命中但装修不满足，整规则不命中', () => {
    const spec = RULES[0].conditionJson as Parameters<typeof evaluateRule>[0];
    expect(evaluateRule(spec, { water_tags: ['水管老化'], decorate_status: '1-3年' })).toBe(false);
  });
});

describe('真实规则集匹配与单包收敛', () => {
  it('渗漏房屋只命中渗漏包', () => {
    const labels = { water_tags: ['水管老化'], decorate_status: '5-10年', family_structure: 'D_三口之家' };
    const winner = selectWinningRule(matchRulesForHouse(RULES, labels));
    expect(winner?.packageId).toBe(101n);
  });

  it('同时满足渗漏与刷新时，互斥组内按 priority 收敛为渗漏', () => {
    const labels = {
      water_tags: ['卫生间漏水'],
      env_tags: ['墙面发霉'],
      decorate_status: '未装修',
      family_structure: 'A_三代同堂',
    };
    const matches = matchRulesForHouse(RULES, labels);
    expect(matches.map((m) => m.packageId).sort()).toEqual([101n, 103n]);
    expect(selectWinningRule(matches)?.packageId).toBe(101n);
  });

  it('disabled 的浴改淋规则永不命中', () => {
    const labels = { house_feature_tags: ['带浴缸户型'], decorate_status: '未装修', family_structure: 'B_多孩之家' };
    expect(matchRulesForHouse(RULES, labels)).toHaveLength(0);
  });

  it('年轻装修二人世界不命中任何包', () => {
    expect(
      selectWinningRule(
        matchRulesForHouse(RULES, { decorate_status: '1-3年', family_structure: 'E_二人世界' }),
      ),
    ).toBeNull();
  });
});
