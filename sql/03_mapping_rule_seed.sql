-- =================================================================================
-- 03_mapping_rule_seed.sql
-- 「产品包 × 标签」映射规则初始化种子（PostgreSQL 16）
-- 事实源：资料/映射关系.md（业务给定的圈选条件）+ docs/DATA-CONTRACT.md §3/§6
-- 规则引擎口径（全端统一，禁止反向表述）：
--   priority 升序，数值越小优先级越高，1 = 最高；同组单包输出；同层 AND 短路。
-- 多值标签操作符：contains_any（逗号串拆分后有交集即命中）。
-- 幂等：按规则名冲突更新（名称是业务可读稳定键）。
-- =================================================================================

-- 业务唯一约束：规则名唯一（架构 §6（4）原索引为 (status,priority)，幂等种子需要）
CREATE UNIQUE INDEX IF NOT EXISTS uq_mapping_rule_name ON mapping_rule (name);

INSERT INTO mapping_rule (name, package_id, priority, mutex_group_id, condition_logic, condition_json, status, remark)
SELECT
  v.name,
  pp.id,
  v.priority,
  mg.id,
  'AND',
  v.condition_json::jsonb,
  v.status,
  v.remark
FROM (
  VALUES
  (
    '渗漏检测-水路问题老装修房屋',
    'PKG-SEEP',
    10,
    '居家改造类互斥组',
    'enabled',
    '{"logic":"AND","conditions":[{"tag":"water_tags","op":"contains_any","value":["卫生间漏水","厨房漏水","阳台漏水","水管老化"]},{"tag":"decorate_status","op":"in","value":["5-10年","未装修"]}]}',
    '业务映射：水路标签（卫生间漏水/水管老化/阳台漏水/厨房漏水）× 装修状态（5-10年/未装修）。来源：资料/映射关系.md'
  ),
  (
    '浴改淋-带浴缸多成员未装修房屋',
    'PKG-TUB2SHOWER',
    20,
    '居家改造类互斥组',
    'disabled',
    '{"logic":"AND","conditions":[{"tag":"house_feature_tags","op":"contains_any","value":["带浴缸户型"]},{"tag":"family_structure","op":"in","value":["A_三代同堂","B_多孩之家","C_二孩之家","D_三口之家"]},{"tag":"decorate_status","op":"eq","value":"未装修"}]}',
    '【GAP-2 未就绪，禁止启用】「带浴缸户型」标签在当前标签宽表不存在，待 DATA-CONTRACT §8 Q2 探查确认数据源（入户问卷/diana房屋问题标签/装修备案）后接入；家庭结构真实值带 A_~D_ 前缀。来源：资料/映射关系.md'
  ),
  (
    '墙面刷新-墙面问题多成员老装修房屋',
    'PKG-REFRESH',
    30,
    '居家改造类互斥组',
    'enabled',
    '{"logic":"AND","conditions":[{"tag":"env_tags","op":"contains_any","value":["瓷砖开裂空鼓","墙面发霉","渗水/返潮"]},{"tag":"family_structure","op":"in","value":["A_三代同堂","B_多孩之家","C_二孩之家","D_三口之家"]},{"tag":"decorate_status","op":"in","value":["5-10年","未装修"]}]}',
    '业务映射：环境标签（瓷砖开裂空鼓/墙面发霉/渗水返潮）× 家庭结构（三代/多孩/二孩/三口）× 装修状态（5-10年/未装修）。注意环境标签真实值为「渗水/返潮」（带斜杠）。来源：资料/映射关系.md'
  )
) AS v(name, pkg_code, priority, group_name, status, condition_json, remark)
JOIN product_package pp ON pp.code = v.pkg_code
JOIN mutex_group mg ON mg.name = v.group_name
ON CONFLICT (name) DO UPDATE
SET package_id       = EXCLUDED.package_id,
    priority        = EXCLUDED.priority,
    mutex_group_id  = EXCLUDED.mutex_group_id,
    condition_logic = EXCLUDED.condition_logic,
    condition_json  = EXCLUDED.condition_json,
    status          = EXCLUDED.status,
    remark          = EXCLUDED.remark;

-- 运维查询：规则与命中条件核对（启用前请先用 /rules/preview 做空命中与重叠校验）
-- SELECT mr.name, pp.code AS package_code, mr.priority, mg.name AS mutex_group,
--        mr.status, mr.condition_json
-- FROM mapping_rule mr
-- JOIN product_package pp ON pp.id = mr.package_id
-- LEFT JOIN mutex_group mg ON mg.id = mr.mutex_group_id
-- ORDER BY mr.priority;
