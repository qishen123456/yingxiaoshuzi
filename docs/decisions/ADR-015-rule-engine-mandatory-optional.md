# ADR-015: 规则引擎升级为「必选组 + 可选组 + 三级排序」

## Status

Accepted (2026-10-09)

## Background

Phase 1 演示设计阶段，业务在「映射规则怎么落表」评审时提出：
> "5-10 年未装修是**必须的**（必选组），然后其他水/电/环境标签满足**一个**就算命中（可选组）。"

且要求：
- 命中更多标签的规则排得**更前**（hit_count 动态优先级）
- 当两条规则在标签层面打平时，由**营销手动维护的优先级**兜底（如 渗漏 > 浴改淋 > 刷新）

这是对原型 `rule-engine.ts` 现有 `{logic: AND|OR, conditions: [...]}` 单层模型的扩展：
- 原模型只能表达「所有条件 AND」或「任一条件 OR」
- 业务真实诉求是「**必选全中 + 可选命中 K 个**」，且**多规则按命中数 + 人工优先级**排序

## Decision

### D1 — 条件表达式升级为「必选组 + 可选组」

`conditionJson` 字段结构由：

```json
{ "logic": "AND", "conditions": [...] }
```

升级为：

```json
{
  "mandatory": [ ...条件项，必选组必须全部命中 ],
  "optional":  [ ...条件项，可选组至少命中 minOptionalHits 个 ],
  "minOptionalHits": 1
}
```

- `mandatory` 数组里所有条件**必须全部命中**（隐式 AND）
- `optional` 数组里**至少命中 `minOptionalHits` 个**（命中数 ≥ 阈值）
- 整体规则命中 = `mandatory 全部命中 AND optional 命中数 ≥ minOptionalHits`
- `minOptionalHits` 默认 1，可配为 N（0 即"可选组无要求"）

### D2 — 多规则排序升级为「三级排序」

当同一户房屋命中多条规则时，按以下顺序挑出胜出者：

```
1. manual_priority ASC  （人工维护的优先级，数字越小越靠前）
2. hit_count DESC       （命中标签总数，含 mandatory 和 optional）
3. id ASC               （兜底：先入库的规则胜出）
```

**与原模型的差异**：
- 原模型：仅按 `priority ASC` 单级排序
- 新模型：引入 `hit_count` 作为动态优先级，`manual_priority` 作为业务兜底

### D3 — 字段映射与兼容

| 旧字段 | 新字段 | 说明 |
|---|---|---|
| `conditionLogic: "AND"` + 所有 conditions | 全部塞进 `mandatory` | 原"全部满足"语义 |
| `conditionLogic: "OR"` + 所有 conditions | 全部塞进 `optional`，`minOptionalHits: 1` | 原"任一满足"语义 |
| `priority` 字段 | **保留并重命名为 `manual_priority`** | 不重命名也行，语义对齐即可 |
| — | 新增 `hit_count` 字段（计算列，**不入库**） | 评估时实时算 |

**兼容策略**：rule-engine 启动时检测 `conditionJson` 结构：
- 有 `mandatory` 字段 → 走新模型
- 只有 `logic + conditions` → 走旧模型（按原行为兜底，避免历史数据失效）

旧数据可一次性 ETL 迁移（见 Consequences ①）。

### D4 — UI 必须"零培训可用"（承接 ADR-014 D3）

必选/可选的概念对业务而言是新的，UI 不能直接抛这两个名词。**包装口径**：

| 内部名 | UI 展示名 | 业务理解 |
|---|---|---|
| `mandatory` | **"硬性门槛"** 或 "必选标签" | "这些标签，**房主必须有**，缺一不可" |
| `optional`  | **"加分项"** 或 "推荐标签" | "这些标签，**有几个算几个**，命中越多越优先" |
| `minOptionalHits` | **"至少命中几个"** | 默认 1，营销可调 |
| `hit_count` | **"匹配度"** | 列表里直接显示为"匹配 5 项"，业务一眼看懂 |
| `manual_priority` | **"默认优先级"** | "标签打平的时候按这个排" |

**禁止 UI 出现**：JSON、逻辑表达式、OR/AND、mutexGroupId 这种技术词。

## Consequences

### 正面

- 表达力对齐业务真实诉求：从「全满足/部分满足」二选一 → 「必选门槛 + 可选加分」两层
- 命中数动态排序：业务不用担心"漏配一个标签就被甩到后面"
- 人工优先级兜底：营销对"标签重叠时谁先出"有最终话语权
- 旧数据可平滑迁移，不破坏现有 mapping_rule 记录

### 负面 / 必须处理

**① 历史数据 ETL 迁移**
- 现有 `conditionJson` 是 `{logic, conditions}` 形态，需一次性转成新结构
- 转换规则见 D3 表格，SQL 大概 1 小时内能跑完
- 行动项：跑 ETL 前**先备份 mapping_rule 全表**

**② hit_count 评估性能**
- 每户每条规则都要遍历 mandatory + optional 数组，O(户数 × 规则数 × 条件项数)
- 一期 125.7 万户 × ~10 条规则 × ~5 个条件 = ~6000 万次比较
- 优化手段：先用 `mandatory` 做粗筛（无 mandatory 命中直接淘汰），再算 `optional` 命中数
- **一期可接受，二期若规则 > 50 条需引入位图索引**（写在开发实施手册 W2 待办）

**③ minOptionalHits 的边界**
- 设为 0 → 可选组无要求（等价于"无 optional"）
- 设为 > optional.length → 永远不命中（业务配错场景）
- UI 必须在超出范围时**红色提示**："至少命中 5 个，但可选标签只有 3 个"（见 ADR-014 三件套的冲突提示）

**④ 与"互斥组（mutexGroupId）"的关系**
- mutexGroupId 仍然保留：在同一互斥组内，按新三级排序（manual_priority, hit_count, id）挑出第一名
- 跨互斥组的规则**互不影响**（一户可能命中不同互斥组的多个产品包）

## 4 条示例规则（用新结构）

| 规则 | 必选组 (mandatory) | 可选组 (optional) | minOptionalHits | manual_priority | 互斥组 |
|---|---|---|---|---|---|
| 渗漏检测包 | 装修状态 ∈ {5-10年, 未装修} | 水路标签 ∈ {卫生间漏水, 水管老化, 阳台漏水, 厨房漏水} | 1 | 1 | water |
| 墙面刷新包 | 装修状态 ∈ {5-10年, 未装修} | 环境标签 ∈ {瓷砖开裂, 墙面发霉, 渗水返潮} | 1 | 3 | reno |
| 浴改淋升级包 | 装修状态 ∈ {10年以上, 未装修} | 户型标签 ∈ {带浴缸} | 1 | 2 | bath |
| 价格敏感提醒 | — | 价格敏感度 ∈ {高, 中} ∩ 活跃度 ∈ {近30天活跃} | 2 | 4 | price |

**解读示例**（规则 1 渗漏）：
- 必选：`装修状态` 必须是 5-10 年或未装修（**没有就淘汰**）
- 可选：`水路标签` 命中 1 个就算命中
- 一户命中"5-10年+卫生间漏水+水管老化" → mandatory 命中 1 + optional 命中 2 = hit_count 3
- 一户命中"5-10年+卫生间漏水" → hit_count 2
- 两条规则都满足的，按 manual_priority 排：渗漏(1) > 浴改淋(2) > 刷新(3) > 价格敏感(4)

## Related ADRs

- ADR-014 D3：规则责任归营销管理岗 → 本 ADR D4 由此延伸出 UI 包装口径
- ADR-014 D3 三件套（命中预览/冲突提示/可回滚）→ 本 ADR D4 强调 "minOptionalHits 越界" 需红色提示
- ADR-006（海报模板套版）：本 ADR 同样以「表达力做减法、复杂度收进系统」为原则

## 待同步更新的文档（行动项）

| 文档 | 要改什么 |
|---|---|
| `docs/演示材料/00-映射规则怎么落表.md` | conditionJson 结构升级为 mandatory/optional；JSON 示例用新结构重写 |
| `docs/演示材料/01-业务规则与演示流程.md` | 4 条规则的"硬性门槛 / 加分项"包装口径 |
| `docs/开发实施手册.md` W2 | rule-engine.ts 实现 mandatory/optional + 三级排序；旧数据 ETL 步骤 |
| `docs/UIUX.md` 规则配置页 | 增加"硬性门槛 / 加分项 / 至少命中几个 / 匹配度"4 个 UI 元素 |
| `.workbuddy/memory/MEMORY.md` | 加入"规则结构 = mandatory+optional+minOptionalHits"硬约束 |
