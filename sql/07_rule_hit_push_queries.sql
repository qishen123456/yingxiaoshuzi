-- =============================================================================
-- 07_rule_hit_push_queries.sql
-- 配置驱动的命中清单、推送候选清单、单房屋线索查询
-- 数据库：PostgreSQL 16（应用库）
--
-- 重要边界：
-- 1. 本文件的函数用来做 SQL 验数、规则命中预览和候选清单查询；
--    正式跑批仍由后端规则引擎 + 频控服务执行，禁止直接拿候选结果外发。
-- 2. 命中规则字段/操作符与 backend/src/engine/rule-engine.ts 保持一致。
-- 3. 推送前仍需检查黑名单、退订、号码覆盖率、发送时段、客户与房屋频控。
-- 4. lead_record 是应用库的既有线索镜像；其上游源表按数据契约为 T+1 快照。
--    “打开房屋详情时查询”不等于上游数据实时产生，若要分钟级新鲜度需数据/开发另行确认。
-- =============================================================================

-- A. 评估单条标签条件。支持 eq / neq / in / not_in / contains_any /
--    contains_all / exists / gte / lte / between；未知操作符保守不命中。
CREATE OR REPLACE FUNCTION marketing_condition_matches(
  p_labels JSONB,
  p_condition JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_key TEXT;
  v_op TEXT;
  v_actual JSONB;
  v_expected JSONB;
  v_actual_text TEXT;
  v_expected_text TEXT;
  v_actual_values TEXT[];
  v_expected_values TEXT[];
  v_actual_num NUMERIC;
  v_expected_num NUMERIC;
  v_low NUMERIC;
  v_high NUMERIC;
BEGIN
  IF p_labels IS NULL OR p_condition IS NULL OR jsonb_typeof(p_condition) <> 'object' THEN
    RETURN FALSE;
  END IF;

  v_key := p_condition ->> 'tag';
  v_op := p_condition ->> 'op';
  v_actual := p_labels -> v_key;
  v_expected := p_condition -> 'value';

  CASE v_op
    WHEN 'exists' THEN
      RETURN v_actual IS NOT NULL
        AND v_actual <> 'null'::jsonb
        AND v_actual <> '""'::jsonb
        AND v_actual <> '[]'::jsonb;

    WHEN 'eq' THEN
      RETURN v_actual IS NOT NULL AND v_actual = v_expected;

    WHEN 'neq' THEN
      RETURN v_actual IS DISTINCT FROM v_expected;

    WHEN 'in' THEN
      IF v_actual IS NULL OR jsonb_typeof(v_expected) IS DISTINCT FROM 'array' THEN
        RETURN FALSE;
      END IF;
      RETURN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_expected) AS e(value)
        WHERE e.value = v_actual
      );

    WHEN 'not_in' THEN
      IF jsonb_typeof(v_expected) IS DISTINCT FROM 'array' THEN
        RETURN FALSE;
      END IF;
      IF v_actual IS NULL THEN
        RETURN TRUE;
      END IF;
      RETURN NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_expected) AS e(value)
        WHERE e.value = v_actual
      );

    WHEN 'contains_any' THEN
      IF v_actual IS NULL OR jsonb_typeof(v_expected) IS DISTINCT FROM 'array' THEN
        RETURN FALSE;
      END IF;
      v_actual_values := CASE jsonb_typeof(v_actual)
        WHEN 'array' THEN ARRAY(SELECT jsonb_array_elements_text(v_actual))
        WHEN 'string' THEN regexp_split_to_array(v_actual #>> '{}', '\s*,\s*')
        ELSE ARRAY[]::TEXT[]
      END;
      v_expected_values := ARRAY(SELECT jsonb_array_elements_text(v_expected));
      RETURN EXISTS (
        SELECT 1
        FROM unnest(v_actual_values) AS a(value)
        JOIN unnest(v_expected_values) AS e(value) USING (value)
      );

    WHEN 'contains_all' THEN
      IF v_actual IS NULL OR jsonb_typeof(v_expected) IS DISTINCT FROM 'array' OR jsonb_array_length(v_expected) = 0 THEN
        RETURN FALSE;
      END IF;
      v_actual_values := CASE jsonb_typeof(v_actual)
        WHEN 'array' THEN ARRAY(SELECT jsonb_array_elements_text(v_actual))
        WHEN 'string' THEN regexp_split_to_array(v_actual #>> '{}', '\s*,\s*')
        ELSE ARRAY[]::TEXT[]
      END;
      v_expected_values := ARRAY(SELECT jsonb_array_elements_text(v_expected));
      RETURN NOT EXISTS (
        SELECT 1 FROM unnest(v_expected_values) AS e(value)
        WHERE NOT (e.value = ANY(v_actual_values))
      );

    WHEN 'gte' THEN
      IF v_actual IS NULL OR v_expected IS NULL THEN RETURN FALSE; END IF;
      v_actual_text := v_actual #>> '{}';
      v_expected_text := v_expected #>> '{}';
      IF v_actual_text !~ '^[+-]?[0-9]+(\.[0-9]+)?$'
         OR v_expected_text !~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN
        RETURN FALSE;
      END IF;
      RETURN v_actual_text::NUMERIC >= v_expected_text::NUMERIC;

    WHEN 'lte' THEN
      IF v_actual IS NULL OR v_expected IS NULL THEN RETURN FALSE; END IF;
      v_actual_text := v_actual #>> '{}';
      v_expected_text := v_expected #>> '{}';
      IF v_actual_text !~ '^[+-]?[0-9]+(\.[0-9]+)?$'
         OR v_expected_text !~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN
        RETURN FALSE;
      END IF;
      RETURN v_actual_text::NUMERIC <= v_expected_text::NUMERIC;

    WHEN 'between' THEN
      IF v_actual IS NULL OR jsonb_typeof(v_expected) IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_expected) <> 2 THEN
        RETURN FALSE;
      END IF;
      v_actual_text := v_actual #>> '{}';
      v_expected_text := v_expected ->> 0;
      IF v_actual_text !~ '^[+-]?[0-9]+(\.[0-9]+)?$'
         OR v_expected_text !~ '^[+-]?[0-9]+(\.[0-9]+)?$'
         OR (v_expected ->> 1) !~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN
        RETURN FALSE;
      END IF;
      v_actual_num := v_actual_text::NUMERIC;
      v_low := v_expected_text::NUMERIC;
      v_high := (v_expected ->> 1)::NUMERIC;
      RETURN v_actual_num BETWEEN v_low AND v_high;

    ELSE
      RETURN FALSE;
  END CASE;
END;
$$;

-- B. 评估整条规则。空 conditions 一律不命中，避免空配置圈中全部房屋。
CREATE OR REPLACE FUNCTION marketing_rule_matches(
  p_labels JSONB,
  p_rule JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_logic TEXT := upper(COALESCE(p_rule ->> 'logic', 'AND'));
  v_conditions JSONB := p_rule -> 'conditions';
  v_condition JSONB;
  v_count INTEGER := 0;
  v_match BOOLEAN;
BEGIN
  IF jsonb_typeof(v_conditions) <> 'array' OR jsonb_array_length(v_conditions) = 0 THEN
    RETURN FALSE;
  END IF;

  FOR v_condition IN SELECT value FROM jsonb_array_elements(v_conditions)
  LOOP
    v_count := v_count + 1;
    v_match := marketing_condition_matches(p_labels, v_condition);

    IF v_logic = 'OR' AND v_match THEN
      RETURN TRUE;
    END IF;
    IF v_logic <> 'OR' AND NOT v_match THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN v_count > 0 AND v_logic <> 'OR';
END;
$$;

-- C. 命中清单：列出所有满足已启用规则的房屋，可用于核对每条规则的覆盖人数。
-- 参数：把 NULL 改为指定城市 / 项目编码 / 产品包编码；全部为空代表不按该维度限制。
WITH params AS (
  SELECT NULL::TEXT AS city_filter,
         NULL::TEXT AS project_filter,
         NULL::TEXT AS package_code_filter
)
SELECT
  h.house_id,
  h.zhantu_house_id,
  h.house_name,
  h.city,
  h.community_id,
  h.community_name,
  pp.code AS package_code,
  pp.name AS package_name,
  mr.id AS rule_id,
  mr.name AS rule_name,
  mr.priority,
  h.stat_date AS house_data_date
FROM house_label_snapshot h
JOIN mapping_rule mr
  ON mr.status = 'enabled'
JOIN product_package pp
  ON pp.id = mr.package_id
 AND pp.status = 'enabled'
 AND pp.deleted_at IS NULL
CROSS JOIN params p
WHERE marketing_rule_matches(h.labels, mr.condition_json)
  AND (p.city_filter IS NULL OR h.city = p.city_filter)
  AND (p.project_filter IS NULL OR h.community_id = p.project_filter)
  AND (p.package_code_filter IS NULL OR pp.code = p.package_code_filter)
ORDER BY h.city, h.community_name, h.house_id, mr.priority, mr.id;

-- D. 最终命中清单：每套房屋只保留一条最终规则。
-- 当前后端契约为 priority 数值越小越优先，平级按 rule_id 升序；单次跑批只输出一个产品。
WITH params AS (
  SELECT NULL::TEXT AS city_filter,
         NULL::TEXT AS project_filter,
         NULL::TEXT AS package_code_filter
),
all_hits AS (
  SELECT
    h.house_id, h.zhantu_house_id, h.house_name, h.city,
    h.community_id, h.community_name, h.contact_mobile_enc,
    h.customer_key_hash, h.stat_date AS house_data_date,
    pp.id AS package_id, pp.code AS package_code, pp.name AS package_name,
    mr.id AS rule_id, mr.name AS rule_name, mr.priority, mr.mutex_group_id
  FROM house_label_snapshot h
  JOIN mapping_rule mr ON mr.status = 'enabled'
  JOIN product_package pp
    ON pp.id = mr.package_id AND pp.status = 'enabled' AND pp.deleted_at IS NULL
  CROSS JOIN params p
  WHERE marketing_rule_matches(h.labels, mr.condition_json)
    AND (p.city_filter IS NULL OR h.city = p.city_filter)
    AND (p.project_filter IS NULL OR h.community_id = p.project_filter)
    AND (p.package_code_filter IS NULL OR pp.code = p.package_code_filter)
),
ranked AS (
  SELECT *,
         row_number() OVER (PARTITION BY house_id ORDER BY priority ASC, rule_id ASC) AS rn
  FROM all_hits
)
SELECT
  house_id, zhantu_house_id, house_name, city, community_id, community_name,
  package_id, package_code, package_name, rule_id, rule_name, priority,
  (contact_mobile_enc IS NOT NULL) AS has_contact_number,
  house_data_date
FROM ranked
WHERE rn = 1
ORDER BY city, community_name, house_id;

-- E. 推送候选预览：最终规则 + 联系方式覆盖 + 线索静默初筛。
-- 注意：这里只是候选预览，不是最终发送授权；黑名单、退订、全局/房屋频控、
-- 发送时段、通道可用性仍由后端正式发送服务检查。
WITH params AS (
  SELECT CURRENT_DATE::DATE AS as_of_date,
         NULL::TEXT AS city_filter,
         NULL::TEXT AS project_filter,
         NULL::TEXT AS package_code_filter
),
all_hits AS (
  SELECT
    h.house_id, h.zhantu_house_id, h.house_name, h.city,
    h.community_id, h.community_name, h.contact_mobile_enc,
    h.customer_key_hash, h.stat_date AS house_data_date,
    pp.id AS package_id, pp.code AS package_code, pp.name AS package_name,
    mr.id AS rule_id, mr.name AS rule_name, mr.priority
  FROM house_label_snapshot h
  JOIN mapping_rule mr ON mr.status = 'enabled'
  JOIN product_package pp
    ON pp.id = mr.package_id AND pp.status = 'enabled' AND pp.deleted_at IS NULL
  CROSS JOIN params p
  WHERE marketing_rule_matches(h.labels, mr.condition_json)
    AND (p.city_filter IS NULL OR h.city = p.city_filter)
    AND (p.project_filter IS NULL OR h.community_id = p.project_filter)
    AND (p.package_code_filter IS NULL OR pp.code = p.package_code_filter)
),
ranked AS (
  SELECT *,
         row_number() OVER (PARTITION BY house_id ORDER BY priority ASC, rule_id ASC) AS rn
  FROM all_hits
),
winners AS (
  SELECT * FROM ranked WHERE rn = 1
)
SELECT
  w.house_id,
  w.zhantu_house_id,
  w.house_name,
  w.city,
  w.community_id,
  w.community_name,
  w.package_code,
  w.package_name,
  w.rule_id,
  w.rule_name,
  (w.contact_mobile_enc IS NOT NULL) AS has_contact_number,
  COALESCE(l.lead_count, 0) AS lead_count,
  l.latest_lead_at,
  COALESCE(l.same_package_lead_90d, 0) AS same_package_lead_90d,
  COALESCE(l.any_lead_15d, 0) AS any_lead_15d,
  CASE
    WHEN w.contact_mobile_enc IS NULL THEN 'NO_CONTACT_NUMBER'
    WHEN COALESCE(l.same_package_lead_90d, 0) > 0 THEN 'BLOCK_SAME_PACKAGE_LEAD_90D'
    WHEN COALESCE(l.any_lead_15d, 0) > 0 THEN 'BLOCK_RECENT_LEAD_15D'
    ELSE 'PASS_MOBILE_AND_LEAD_PRECHECK'
  END AS precheck_status,
  w.house_data_date
FROM winners w
CROSS JOIN params p
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::INTEGER AS lead_count,
    MAX(lr.lead_created_at) AS latest_lead_at,
    COUNT(*) FILTER (
      WHERE lr.product_package_id = w.package_id
        AND lr.lead_created_at >= p.as_of_date - INTERVAL '90 days'
    )::INTEGER AS same_package_lead_90d,
    COUNT(*) FILTER (
      WHERE lr.lead_created_at >= p.as_of_date - INTERVAL '15 days'
    )::INTEGER AS any_lead_15d
  FROM lead_record lr
  WHERE lr.house_id = w.house_id
    AND lr.stale_in_source = FALSE
) l ON TRUE
ORDER BY w.city, w.community_name, w.house_id;

-- F. 房屋详情页查询应用库中的线索镜像（参数 $1 = Pride 房屋编码）。
-- 按线索创建时间倒序，不返回手机号明文。
SELECT
  lead_id,
  house_id,
  external_package_code,
  product_package_id,
  package_source,
  lead_grade,
  lead_status,
  lead_quality,
  source_channel,
  lead_created_at,
  latest_deal_at,
  order_cnt,
  performance_amount,
  stale_in_source
FROM lead_record
WHERE house_id = $1
ORDER BY lead_created_at DESC
LIMIT 100;

-- G. 如需直接查上游 ADB 线索宽表，在 ADB PostgreSQL 连接上执行。
-- 参数 $1 = Pride 房屋编码，参数 $2 = 战图房屋编码。
-- 上游表本身为 T+1 快照；本查询只是在打开详情时重新读取最新快照，不保证分钟级实时。
SELECT
  clue_id,
  house_code,
  zhantu_housecode,
  intention_first_type,
  intention_second_type,
  customer_level,
  business_status,
  channel_category_l1,
  created_time,
  latest_deal_time,
  order_cnt,
  performance_final
FROM yanxuan.ads_yx_clue_full_detail
WHERE (($1::TEXT IS NOT NULL AND house_code = $1)
    OR ($2::TEXT IS NOT NULL AND zhantu_housecode = $2))
ORDER BY created_time DESC
LIMIT 100;
