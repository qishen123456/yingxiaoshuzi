-- =================================================================================
-- 04_frequency_seed.sql
-- 频控规则 + 可发送时段 初始化种子（PostgreSQL 16）
-- 默认值与 PRD §6.1 / ARCHITECTURE §8 / 第二轮一致性检查 D4、D10 逐字对齐：
--   房屋冷却 7 天 / 同包冷却 30 天 / 日 1 · 周 2 · 月 4
--   全局日上限 5000（100-100000，任何单次任务不可突破，超限顺延次日并告警）
--   可发送时段 10:00-12:00、15:00-18:00（两段，day_type=all）
--   线索静默：同包 90 天 / 客户级 15 天；数据缺失时 fail-open + 显著告警
-- 禁发时段 22:00-次日08:00 为代码级常量，不入库、不可配（本种子不生成该数据）。
-- 幂等：全局只允许一条 scope_type='global' 记录，冲突更新。
-- =================================================================================

-- 线索静默三字段（D10 裁决），架构 §6（10）若尚未建列则随种子补齐
ALTER TABLE push_frequency_rule ADD COLUMN IF NOT EXISTS lead_package_cooldown_days int NOT NULL DEFAULT 90;
ALTER TABLE push_frequency_rule ADD COLUMN IF NOT EXISTS lead_house_cooldown_days    int NOT NULL DEFAULT 15;
ALTER TABLE push_frequency_rule ADD COLUMN IF NOT EXISTS lead_gate_fail_mode        varchar(8) NOT NULL DEFAULT 'open';
COMMENT ON COLUMN push_frequency_rule.lead_package_cooldown_days IS '线索静默·同包长冷却天数（默认90，范围1-365）；命中 LEAD_PACKAGE_COOLDOWN，重推不可覆盖';
COMMENT ON COLUMN push_frequency_rule.lead_house_cooldown_days    IS '线索静默·客户级冷却天数（默认15，范围1-90）；命中 LEAD_HOUSE_COOLDOWN，重推不可覆盖';
COMMENT ON COLUMN push_frequency_rule.lead_gate_fail_mode         IS '线索数据缺失/过期时闸门0策略：open=跳过闸门继续跑批但显著告警（默认）；closed=暂停营销下发';

-- 业务约束：全局频控规则全表只允许一条（scope_type='package' 不受此限）
CREATE UNIQUE INDEX IF NOT EXISTS uq_frequency_global_single
  ON push_frequency_rule (scope_type) WHERE scope_type = 'global';

INSERT INTO push_frequency_rule (
  scope_type, package_id,
  house_cooldown_days, package_cooldown_days,
  house_daily_cap, house_weekly_cap, house_monthly_cap, global_daily_cap,
  cross_channel_count, holiday_skip, status,
  lead_package_cooldown_days, lead_house_cooldown_days, lead_gate_fail_mode
) VALUES (
  'global', NULL,
  7, 30,
  1, 2, 4, 5000,
  true, false, 'enabled',
  90, 15, 'open'
)
ON CONFLICT (scope_type) WHERE scope_type = 'global' DO UPDATE
SET house_cooldown_days           = EXCLUDED.house_cooldown_days,
    package_cooldown_days         = EXCLUDED.package_cooldown_days,
    house_daily_cap               = EXCLUDED.house_daily_cap,
    house_weekly_cap              = EXCLUDED.house_weekly_cap,
    house_monthly_cap             = EXCLUDED.house_monthly_cap,
    global_daily_cap              = EXCLUDED.global_daily_cap,
    cross_channel_count           = EXCLUDED.cross_channel_count,
    holiday_skip                  = EXCLUDED.holiday_skip,
    status                        = EXCLUDED.status,
    lead_package_cooldown_days    = EXCLUDED.lead_package_cooldown_days,
    lead_house_cooldown_days      = EXCLUDED.lead_house_cooldown_days,
    lead_gate_fail_mode           = EXCLUDED.lead_gate_fail_mode;

-- ----------------------------- 可发送时段（多时段子表） -----------------------------
-- 业务唯一约束：同一规则、同一日类型下起始时刻唯一（幂等种子需要）
CREATE UNIQUE INDEX IF NOT EXISTS uq_freq_window_start
  ON push_frequency_window (frequency_rule_id, day_type, window_start);

WITH fr AS (SELECT id FROM push_frequency_rule WHERE scope_type = 'global' LIMIT 1)
INSERT INTO push_frequency_window (frequency_rule_id, day_type, window_start, window_end, enabled, sort_order)
SELECT fr.id, v.day_type, v.window_start::time, v.window_end::time, true, v.sort_order
FROM fr
CROSS JOIN (VALUES
  ('all', '10:00', '12:00', 1),
  ('all', '15:00', '18:00', 2)
) AS v(day_type, window_start, window_end, sort_order)
ON CONFLICT DO NOTHING;

-- 运维查询：频控默认值与当日生效时段
-- SELECT house_cooldown_days, package_cooldown_days,
--        house_daily_cap, house_weekly_cap, house_monthly_cap, global_daily_cap,
--        lead_package_cooldown_days, lead_house_cooldown_days, lead_gate_fail_mode
-- FROM push_frequency_rule WHERE scope_type = 'global';
-- SELECT day_type, window_start, window_end, enabled, sort_order
-- FROM push_frequency_window ORDER BY day_type, sort_order;
