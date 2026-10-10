-- =====================================================================================
-- sql/06_final_rule_engine_and_queries.sql
-- 用途：规则条件判断、原始命中清单、互斥优选清单、推送候选查询、数据核验。
-- 执行引擎：系统业务库 RDS PostgreSQL（不是 MaxCompute / ODPS）。
-- 前提：先执行 Prisma migration 和 sql/01_tag_dictionary_seed.sql 等现有初始化脚本。
--
-- 核心分层：
--   house_label_snapshot.labels JSONB     = 房屋今日实际标签（T+1）
--   tag_dictionary + tag_value            = 人工维护的标签配置，不随 T+1 刷新
--   mapping_rule.condition_json           = 产品包 × 标签条件映射
--   v_house_rule_hit                      = 全量命中（用于解释和预览）
--   v_house_rule_winner                   = 互斥组内按优先级选出的规则
--   push_detail                            = 正式待推送/已推送/失败记录
--
-- 约定：
--   1. labels 的 key 必须与 tag_dictionary.tag_key 和 mapping_rule.condition_json.tag 一致。
--   2. 多值标签在 labels 中优先用 JSON 数组；函数也兼容逗号分隔字符串。
--   3. 同互斥组内 priority 数字越小越优先；同优先级以 rule_id 升序兜底。
--   4. 以下推送候选 SQL 是预筛选；发送时间窗、全局日上限、并发锁和真正入队必须在
--      后端事务中再次检查，避免仅靠预览 SQL 产生并发重复。
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 0. 配置维护示例（默认注释，不会自动执行）
-- 新增现有类别中的枚举值：只改 tag_value，不动房屋 T+1 同步任务。
-- 注意：上游数据中必须实际出现该值，或完成对应字段的同步接入，否则新增值只会出现在配置选项中。
--
-- INSERT INTO tag_value (tag_key, tag_value, sort_order, status)
-- VALUES ('water_tags', '新增水路标签', 90, 'enabled')
-- ON CONFLICT (tag_key, tag_value)
-- DO UPDATE SET sort_order = EXCLUDED.sort_order, status = 'enabled', updated_at = now();
--
-- 新增类别时先在 tag_dictionary 添加 tag_key / tag_group / value_type / source_column /
-- rule_enabled，再逐行加入 tag_value。source_column 不能由用户直接输入 SQL 标识符；
-- 新物理字段必须经过数据团队审查、同步映射更新和验收。
-- -------------------------------------------------------------------------------------

-- -------------------------------------------------------------------------------------
-- 1. 将 JSON 标签值归一化为 text[]。
-- p_split_commas=true 仅用于实际标签值；规则期望值中的普通字符串不拆逗号。
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marketing_tag_text_values(
    p_value jsonb,
    p_split_commas boolean DEFAULT false
)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_text text;
    v_values text[];
BEGIN
    IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
        RETURN ARRAY[]::text[];
    END IF;

    IF jsonb_typeof(p_value) = 'array' THEN
        SELECT COALESCE(array_agg(btrim(x)), ARRAY[]::text[])
          INTO v_values
          FROM jsonb_array_elements_text(p_value) AS t(x)
         WHERE NULLIF(btrim(x), '') IS NOT NULL;
        RETURN v_values;
    END IF;

    IF jsonb_typeof(p_value) = 'string' THEN
        v_text := p_value #>> '{}';

        IF p_split_commas THEN
            SELECT COALESCE(array_agg(btrim(x)), ARRAY[]::text[])
              INTO v_values
              FROM unnest(string_to_array(v_text, ',')) AS t(x)
             WHERE NULLIF(btrim(x), '') IS NOT NULL;
            RETURN v_values;
        END IF;

        IF NULLIF(btrim(v_text), '') IS NULL THEN
            RETURN ARRAY[]::text[];
        END IF;

        RETURN ARRAY[v_text];
    END IF;

    -- 数字、布尔等标量统一转成文本；数值比较仍在下方使用 numeric。
    RETURN ARRAY[p_value #>> '{}'];
END;
$$;

-- -------------------------------------------------------------------------------------
-- 2. 通用映射规则判断函数。
-- 支持：contains_any / contains_all / eq / in / not_in / gte / lte / between。
-- 条件 JSON 示例：
-- {"logic":"AND","conditions":[
--   {"tag":"water_tags","op":"contains_any","value":["卫生间漏水","水管老化"]},
--   {"tag":"decorate_status","op":"in","value":["5-10年","未装修"]}
-- ]}
-- 空条件按 false 处理，避免空配置意外把全量房屋判为命中。
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marketing_rule_condition_matches(
    p_labels jsonb,
    p_condition_json jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_conditions jsonb;
    v_condition jsonb;
    v_logic text;
    v_tag text;
    v_op text;
    v_actual jsonb;
    v_expected jsonb;
    v_actual_values text[];
    v_expected_values text[];
    v_match boolean;
    v_actual_num numeric;
    v_expected_num numeric;
    v_low_num numeric;
    v_high_num numeric;
BEGIN
    v_conditions := p_condition_json -> 'conditions';

    IF jsonb_typeof(v_conditions) IS DISTINCT FROM 'array' THEN
        RETURN false;
    END IF;

    IF jsonb_array_length(v_conditions) = 0 THEN
        RETURN false;
    END IF;

    v_logic := upper(COALESCE(p_condition_json ->> 'logic', 'AND'));
    IF v_logic NOT IN ('AND', 'OR') THEN
        RETURN false;
    END IF;

    FOR v_condition IN
        SELECT value FROM jsonb_array_elements(v_conditions)
    LOOP
        v_tag := NULLIF(btrim(v_condition ->> 'tag'), '');
        v_op := lower(COALESCE(v_condition ->> 'op', 'eq'));
        v_expected := v_condition -> 'value';
        v_actual := CASE
            WHEN v_tag IS NULL OR p_labels IS NULL THEN NULL
            ELSE p_labels -> v_tag
        END;

        v_actual_values := marketing_tag_text_values(v_actual, true);
        v_expected_values := marketing_tag_text_values(v_expected, false);
        v_match := false;

        CASE v_op
            WHEN 'contains_any' THEN
                v_match := v_actual_values && v_expected_values;

            WHEN 'contains_all' THEN
                v_match := v_expected_values <@ v_actual_values;

            WHEN 'eq' THEN
                v_match := cardinality(v_actual_values) = 1
                           AND cardinality(v_expected_values) = 1
                           AND v_actual_values[1] = v_expected_values[1];

            WHEN 'in' THEN
                v_match := v_actual_values && v_expected_values;

            WHEN 'not_in' THEN
                v_match := NOT (v_actual_values && v_expected_values);

            WHEN 'gte' THEN
                BEGIN
                    v_actual_num := NULLIF(p_labels ->> v_tag, '')::numeric;
                    v_expected_num := NULLIF(v_condition ->> 'value', '')::numeric;
                    v_match := COALESCE(v_actual_num >= v_expected_num, false);
                EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
                    v_match := false;
                END;

            WHEN 'lte' THEN
                BEGIN
                    v_actual_num := NULLIF(p_labels ->> v_tag, '')::numeric;
                    v_expected_num := NULLIF(v_condition ->> 'value', '')::numeric;
                    v_match := COALESCE(v_actual_num <= v_expected_num, false);
                EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
                    v_match := false;
                END;

            WHEN 'between' THEN
                BEGIN
                    IF cardinality(v_expected_values) <> 2 THEN
                        v_match := false;
                    ELSE
                        v_actual_num := NULLIF(p_labels ->> v_tag, '')::numeric;
                        v_low_num := NULLIF(v_expected_values[1], '')::numeric;
                        v_high_num := NULLIF(v_expected_values[2], '')::numeric;
                        v_match := COALESCE(
                            v_actual_num >= v_low_num AND v_actual_num <= v_high_num,
                            false
                        );
                    END IF;
                EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
                    v_match := false;
                END;

            ELSE
                -- 未实现/拼错的操作符绝不默认命中。
                v_match := false;
        END CASE;

        IF v_logic = 'AND' AND NOT COALESCE(v_match, false) THEN
            RETURN false;
        END IF;

        IF v_logic = 'OR' AND COALESCE(v_match, false) THEN
            RETURN true;
        END IF;
    END LOOP;

    -- AND 全部通过才命中；OR 无任何条件通过则不命中。
    RETURN v_logic = 'AND';
END;
$$;

COMMENT ON FUNCTION marketing_rule_condition_matches(jsonb, jsonb)
IS '按 mapping_rule.condition_json 计算房屋标签是否命中；未知操作符或空条件按不命中处理';

-- -------------------------------------------------------------------------------------
-- 3. 原始命中视图：一套房可能命中多条规则，用于命中清单与规则解释。
-- 只选最新成功写入的标签快照日期；标签字典/映射配置不会受本视图影响。
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_house_rule_hit AS
SELECT
    h.stat_date,
    h.house_id,
    h.zhantu_house_id,
    h.house_name,
    h.community_id,
    h.community_name,
    h.region,
    h.city,
    h.branch,
    h.station,
    h.station_code,
    h.labels,
    pp.id AS package_id,
    pp.code AS package_code,
    pp.name AS package_name,
    mr.id AS rule_id,
    mr.name AS rule_name,
    mr.priority,
    mr.mutex_group_id,
    mg.name AS mutex_group_name
FROM house_label_snapshot h
JOIN (SELECT MAX(stat_date) AS latest_stat_date FROM house_label_snapshot) latest
  ON h.stat_date = latest.latest_stat_date
JOIN mapping_rule mr
  ON mr.status = 'enabled'
JOIN product_package pp
  ON pp.id = mr.package_id
 AND pp.status = 'enabled'
 AND pp.deleted_at IS NULL
LEFT JOIN mutex_group mg
  ON mg.id = mr.mutex_group_id
WHERE marketing_rule_condition_matches(
    h.labels::jsonb,
    jsonb_set(
        COALESCE(mr.condition_json::jsonb, '{}'::jsonb),
        '{logic}',
        to_jsonb(COALESCE(mr.condition_logic, 'AND')),
        true
    )
);

COMMENT ON VIEW v_house_rule_hit
IS '房屋标签与启用映射规则的全量命中结果；用于命中清单/预览，不代表可直接发送';

-- 查询命中清单示例：所有命中，不做互斥裁决，不检查发送频控。
-- SELECT stat_date, house_id, house_name, community_name, package_name,
--        rule_name, priority, mutex_group_name, labels
-- FROM v_house_rule_hit
-- ORDER BY priority ASC, community_name, house_id;

-- -------------------------------------------------------------------------------------
-- 4. 互斥优选视图：每套房在同一互斥组内只保留最高优先级规则。
-- 没有互斥组的规则互不排斥；因此同一房屋仍可能对应多个独立产品包。
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_house_rule_winner AS
SELECT *
FROM (
    SELECT
        hit.*,
        ROW_NUMBER() OVER (
            PARTITION BY
                hit.house_id,
                CASE
                    WHEN hit.mutex_group_id IS NOT NULL
                        THEN 'GROUP:' || hit.mutex_group_id::text
                    ELSE 'RULE:' || hit.rule_id::text
                END
            ORDER BY hit.priority ASC, hit.rule_id ASC
        ) AS mutex_rank
    FROM v_house_rule_hit hit
) ranked
WHERE mutex_rank = 1;

COMMENT ON VIEW v_house_rule_winner
IS '互斥组内按 priority 升序选出优胜规则；仍需经过联系方式、退订、时间窗和频控检查';

-- -------------------------------------------------------------------------------------
-- 5. 推送候选清单查询（RDS PostgreSQL）。
-- 这不是“已发送清单”：最终任务生成应在后端事务中重新检查并写入 push_task/push_detail。
-- 约定 suppression_list.target_type 使用 house_id / customer_key_hash；若代码枚举不同，
-- 需统一该字典值后再启用此段查询。
-- -------------------------------------------------------------------------------------
WITH candidates AS (
    SELECT
        w.stat_date,
        w.house_id,
        w.zhantu_house_id,
        w.house_name,
        w.community_id,
        w.community_name,
        w.region,
        w.city,
        w.branch,
        w.station,
        w.package_id,
        w.package_code,
        w.package_name,
        w.rule_id,
        w.rule_name,
        w.priority,
        h.contact_mobile_enc,
        h.customer_key_hash,
        COALESCE(fr.house_cooldown_days, 7) AS house_cooldown_days,
        COALESCE(fr.package_cooldown_days, 30) AS package_cooldown_days,
        COALESCE(fr.house_daily_cap, 1) AS house_daily_cap,
        COALESCE(fr.house_weekly_cap, 2) AS house_weekly_cap,
        COALESCE(fr.house_monthly_cap, 4) AS house_monthly_cap
    FROM v_house_rule_winner w
    JOIN house_label_snapshot h
      ON h.house_id = w.house_id
     AND h.stat_date = w.stat_date
    LEFT JOIN LATERAL (
        SELECT p.*
        FROM push_frequency_rule p
        WHERE p.status = 'enabled'
          AND (
              (p.scope_type = 'package' AND p.package_id = w.package_id)
              OR p.scope_type = 'global'
          )
        ORDER BY
          CASE WHEN p.scope_type = 'package' THEN 0 ELSE 1 END,
          p.id DESC
        LIMIT 1
    ) fr ON true
    WHERE h.contact_mobile_enc IS NOT NULL
      AND h.customer_key_hash IS NOT NULL

      -- 黑名单/退订/人工抑制；到期记录不再阻断。
      AND NOT EXISTS (
          SELECT 1
          FROM suppression_list s
          WHERE (s.expires_at IS NULL OR s.expires_at > now())
            AND (
                (s.target_type = 'house_id' AND s.target_value = w.house_id)
                OR
                (s.target_type = 'customer_key_hash' AND s.target_value = h.customer_key_hash)
            )
      )

      -- 同一房屋冷却期：所有非失败/非取消的队列或推送记录都应阻止重复入队。
      AND NOT EXISTS (
          SELECT 1
          FROM push_detail pd
          WHERE pd.house_id = w.house_id
            AND pd.created_at >= now() - make_interval(days => COALESCE(fr.house_cooldown_days, 7))
            AND COALESCE(pd.status, '') NOT IN ('failed', 'cancelled')
      )

      -- 同一房屋、同一产品包冷却期。
      AND NOT EXISTS (
          SELECT 1
          FROM push_detail pd
          WHERE pd.house_id = w.house_id
            AND pd.package_id = w.package_id
            AND pd.created_at >= now() - make_interval(days => COALESCE(fr.package_cooldown_days, 30))
            AND COALESCE(pd.status, '') NOT IN ('failed', 'cancelled')
      )

      -- 每日/每周/每月房屋发送次数上限；统计所有通道时需与 push_frequency_rule.cross_channel_count 一致。
      AND (
          SELECT COUNT(*)
          FROM push_detail pd
          WHERE pd.house_id = w.house_id
            AND pd.created_at >= date_trunc('day', now())
            AND COALESCE(pd.status, '') NOT IN ('failed', 'cancelled')
      ) < COALESCE(fr.house_daily_cap, 1)

      AND (
          SELECT COUNT(*)
          FROM push_detail pd
          WHERE pd.house_id = w.house_id
            AND pd.created_at >= now() - interval '7 days'
            AND COALESCE(pd.status, '') NOT IN ('failed', 'cancelled')
      ) < COALESCE(fr.house_weekly_cap, 2)

      AND (
          SELECT COUNT(*)
          FROM push_detail pd
          WHERE pd.house_id = w.house_id
            AND pd.created_at >= now() - interval '30 days'
            AND COALESCE(pd.status, '') NOT IN ('failed', 'cancelled')
      ) < COALESCE(fr.house_monthly_cap, 4)
)
SELECT *
FROM candidates
ORDER BY priority ASC, community_name, house_id, package_id;

-- 重要：生产服务生成任务前还需核验：
-- 1) push_frequency_window 是否覆盖当前时刻及 day_type/节假日策略；
-- 2) 全局每日发送量是否超出 global_daily_cap；
-- 3) 是否已有同业务日期的 campaign_task / push_task；
-- 4) 使用事务/锁再次校验频控并写入 queued 记录，以防并发作业重复发送；
-- 5) “发送清单”应查询 push_detail，而不是长期复用此候选 SQL 的瞬时结果。

-- -------------------------------------------------------------------------------------
-- 6. 数据质量与配置校验
-- -------------------------------------------------------------------------------------

-- A. 最新快照日期、房屋数与关键标签非空情况。
SELECT
    stat_date,
    COUNT(*) AS row_count,
    COUNT(DISTINCT house_id) AS distinct_house_count,
    COUNT(*) FILTER (WHERE NULLIF(labels::jsonb ->> 'water_tags', '') IS NOT NULL) AS houses_with_water_tag,
    COUNT(*) FILTER (WHERE NULLIF(labels::jsonb ->> 'env_tags', '') IS NOT NULL) AS houses_with_env_tag
FROM house_label_snapshot
GROUP BY stat_date
ORDER BY stat_date DESC
LIMIT 7;

-- B. 标签配置是否缺少可选值（单值、数值类可按业务定义不需要 tag_value）。
SELECT td.tag_key, td.tag_name, td.value_type, td.source_column
FROM tag_dictionary td
LEFT JOIN tag_value tv
  ON tv.tag_key = td.tag_key
 AND tv.status = 'enabled'
WHERE td.rule_enabled = true
  AND td.value_type IN ('enum', 'multi_enum')
GROUP BY td.tag_key, td.tag_name, td.value_type, td.source_column
HAVING COUNT(tv.id) = 0
ORDER BY td.tag_group, td.tag_key;

-- C. 规则中引用了未登记的标签 key 时列出待修复规则。
-- 用于上线检查；标签值本身还需另外核对 tag_value 与实际快照值的交集。
SELECT mr.id, mr.name, cond ->> 'tag' AS unknown_tag_key
FROM mapping_rule mr
CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(mr.condition_json::jsonb -> 'conditions', '[]'::jsonb)
) AS x(cond)
LEFT JOIN tag_dictionary td
  ON td.tag_key = x.cond ->> 'tag'
WHERE mr.status = 'enabled'
  AND td.tag_key IS NULL
ORDER BY mr.priority, mr.id;

-- D. 按规则核对命中量，所有启用规则都应可解释，不应出现空条件全量命中。
SELECT rule_id, rule_name, package_code, package_name, priority,
       COUNT(DISTINCT house_id) AS matched_house_count
FROM v_house_rule_hit
GROUP BY rule_id, rule_name, package_code, package_name, priority
ORDER BY priority, rule_id;
