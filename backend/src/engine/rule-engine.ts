/**
 * 规则引擎（纯函数，无数据库/HTTP 依赖，可单测）。
 * 契约：docs/DATA-CONTRACT.md §3「多值标签匹配语义」、ARCHITECTURE.md §7。
 * 关键事实：
 *  - 多值标签在 labels JSONB 中已被同步 merge 拆为 string[]（上游是逗号串）；
 *  - 空值/空数组对 contains_any/contains_all 恒为 false；
 *  - priority 升序，数值越小优先级越高；同互斥组单包输出；平级以 ruleId 升序兜底。
 */

export type Operator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'contains_any'
  | 'contains_all'
  | 'exists'
  | 'gte'
  | 'lte'
  | 'between';

export interface ConditionSpec {
  tag: string;
  op: Operator;
  value?: unknown;
}

export interface RuleConditionSpec {
  logic: 'AND' | 'OR';
  conditions: ConditionSpec[];
}

/** 房屋标签键值对（house_label_snapshot.labels 反序列化结果）。 */
export type HouseLabels = Record<string, unknown>;

export interface RuleMatchInput {
  id: bigint;
  packageId: bigint;
  priority: number;
  mutexGroupId: bigint | null;
  conditionJson: unknown;
  status: string;
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string' && v.trim() !== '') return v.split(',').map((s) => s.trim());
  return [];
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** 评估单个条件；未知操作符按 false 处理（保守不命中，不抛错中断跑批）。 */
export function evaluateCondition(c: ConditionSpec, labels: HouseLabels): boolean {
  const actual = labels[c.tag];
  const expected = c.value;
  switch (c.op) {
    case 'exists':
      return actual !== null && actual !== undefined && actual !== '' && !(Array.isArray(actual) && actual.length === 0);
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'in':
      return Array.isArray(expected) && actual !== null && actual !== undefined && expected.includes(actual);
    case 'not_in':
      return Array.isArray(expected) && !expected.includes(actual);
    case 'contains_any': {
      if (!Array.isArray(expected)) return false;
      const hit = asArray(actual);
      if (hit.length === 0) return false;
      return expected.some((v) => hit.includes(String(v)));
    }
    case 'contains_all': {
      if (!Array.isArray(expected) || expected.length === 0) return false;
      const hit = asArray(actual);
      if (hit.length === 0) return false;
      return expected.every((v) => hit.includes(String(v)));
    }
    case 'gte': {
      const a = asNumber(actual);
      const b = asNumber(expected);
      return a !== null && b !== null && a >= b;
    }
    case 'lte': {
      const a = asNumber(actual);
      const b = asNumber(expected);
      return a !== null && b !== null && a <= b;
    }
    case 'between': {
      const a = asNumber(actual);
      if (!Array.isArray(expected) || expected.length !== 2) return false;
      const lo = asNumber(expected[0]);
      const hi = asNumber(expected[1]);
      return a !== null && lo !== null && hi !== null && a >= lo && a <= hi;
    }
    default:
      return false;
  }
}

/** 评估一条规则（MVP 仅 AND 短路；OR 预留）。空条件不命中（避免全量误圈）。 */
export function evaluateRule(spec: RuleConditionSpec, labels: HouseLabels): boolean {
  if (!spec.conditions || spec.conditions.length === 0) return false;
  if (spec.logic === 'OR') return spec.conditions.some((c) => evaluateCondition(c, labels));
  return spec.conditions.every((c) => evaluateCondition(c, labels));
}

/**
 * 互斥归并 + 全局取一：
 * 1) 同互斥组内只保留 priority 最小（平级 ruleId 最小）；
 * 2) 无组规则各自保留；
 * 3) 在全部剩余候选中取 priority 最小（平级 ruleId 最小）。
 * 返回该房屋最终命中的规则（单包输出）；无命中返回 null。
 */
export interface MatchedRule {
  ruleId: bigint;
  packageId: bigint;
  priority: number;
  mutexGroupId: bigint | null;
}

export function selectWinningRule(allMatches: MatchedRule[]): MatchedRule | null {
  if (allMatches.length === 0) return null;
  const byId = (a: MatchedRule, b: MatchedRule): number =>
    a.priority - b.priority || (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0);

  const groups = new Map<bigint, MatchedRule>();
  const standalone: MatchedRule[] = [];
  for (const m of allMatches) {
    if (m.mutexGroupId === null) {
      standalone.push(m);
    } else {
      const cur = groups.get(m.mutexGroupId);
      if (!cur || byId(m, cur) < 0) groups.set(m.mutexGroupId, m);
    }
  }
  const candidates = [...groups.values(), ...standalone];
  return candidates.sort(byId)[0] ?? null;
}

/** 便捷：对单房屋跑全部启用规则，返回原始命中列表（未经互斥收敛）。 */
export function matchRulesForHouse(rules: RuleMatchInput[], labels: HouseLabels): MatchedRule[] {
  const out: MatchedRule[] = [];
  for (const r of rules) {
    if (r.status !== 'enabled') continue;
    const spec = r.conditionJson as RuleConditionSpec;
    if (evaluateRule(spec, labels)) {
      out.push({ ruleId: r.id, packageId: r.packageId, priority: r.priority, mutexGroupId: r.mutexGroupId });
    }
  }
  return out;
}
