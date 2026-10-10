-- SQL 附录：标签长表 + 房屋筛选服务表
-- 本文件用于开发设计和数据契约核对；执行前请在目标环境确认 schema、调度变量及 staging 字段。
-- 第 1/2 节为 ODPS；第 3/4 节为 PostgreSQL。两套 SQL 属于不同引擎，不能放在同一个引擎执行。

-- A. MaxCompute / ODPS：一房一标签值一行的圈选事实表
-- 来源：weijia.dwd_yanxuan_responsible_project_hosue_label（每日全量宽表）
-- 调度变量：${bizdate}；步骤 02 静态值字典先于本节点，动态值字典在本节点后回灌。
CREATE TABLE IF NOT EXISTS weijia.dwd_yx_house_tag_detail (
  house_code STRING COMMENT '战图房屋编码',
  house_pride_code STRING COMMENT 'Pride 房屋编码，来源宽表 code',
  region_name STRING COMMENT '大区',
  city_group_name STRING COMMENT '城市分公司',
  asset_code STRING COMMENT '责任盘项目编码',
  asset_name STRING COMMENT '责任盘项目名称',
  category_code STRING COMMENT '标签类别编码',
  tag_value_code STRING COMMENT '枚举标签稳定值编码；动态值首轮可为空',
  tag_value_name STRING COMMENT '枚举标签中文值；数值类为空',
  tag_value_num DECIMAL(38,4) COMMENT '数值标签值，如房龄、面积、维修次数'
)
COMMENT '研选房屋标签明细长表；每日一分区，一房一类别一值一行'
PARTITIONED BY (pt STRING COMMENT '业务日期 yyyyMMdd');

-- B. 每日写入标签明细长表：多值拆行、单值一行、数值单独落列
INSERT OVERWRITE TABLE weijia.dwd_yx_house_tag_detail
PARTITION (pt = '${bizdate}')
SELECT DISTINCT
  house_code, house_pride_code, region_name, city_group_name,
  asset_code, asset_name, category_code, tag_value_code, tag_value_name, tag_value_num
FROM (
  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'repair_water' AS category_code,
         v.value_code AS tag_value_code, TRIM(w1.raw_val) AS tag_value_name,
         CAST(NULL AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  LATERAL VIEW EXPLODE(SPLIT(COALESCE(d.shuilu_label, ''), ',')) w1 AS raw_val
  LEFT JOIN weijia.dim_yx_house_tag_value v
    ON v.category_code = 'repair_water' AND v.value_name = TRIM(w1.raw_val)
  WHERE d.house_code IS NOT NULL AND d.house_code <> ''
    AND TRIM(w1.raw_val) <> ''

  UNION ALL

  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'repair_circuit' AS category_code,
         v.value_code AS tag_value_code, TRIM(w2.raw_val) AS tag_value_name,
         CAST(NULL AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  LATERAL VIEW EXPLODE(SPLIT(COALESCE(d.dianlu_label, ''), ',')) w2 AS raw_val
  LEFT JOIN weijia.dim_yx_house_tag_value v
    ON v.category_code = 'repair_circuit' AND v.value_name = TRIM(w2.raw_val)
  WHERE d.house_code IS NOT NULL AND d.house_code <> ''
    AND TRIM(w2.raw_val) <> ''

  UNION ALL

  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'repair_appliance' AS category_code,
         v.value_code AS tag_value_code, TRIM(w3.raw_val) AS tag_value_name,
         CAST(NULL AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  LATERAL VIEW EXPLODE(SPLIT(COALESCE(d.jiadian_label, ''), ',')) w3 AS raw_val
  LEFT JOIN weijia.dim_yx_house_tag_value v
    ON v.category_code = 'repair_appliance' AND v.value_name = TRIM(w3.raw_val)
  WHERE d.house_code IS NOT NULL AND d.house_code <> ''
    AND TRIM(w3.raw_val) <> ''

  UNION ALL

  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'repair_env' AS category_code,
         v.value_code AS tag_value_code, TRIM(w4.raw_val) AS tag_value_name,
         CAST(NULL AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  LATERAL VIEW EXPLODE(SPLIT(COALESCE(d.envir_label, ''), ',')) w4 AS raw_val
  LEFT JOIN weijia.dim_yx_house_tag_value v
    ON v.category_code = 'repair_env' AND v.value_name = TRIM(w4.raw_val)
  WHERE d.house_code IS NOT NULL AND d.house_code <> ''
    AND TRIM(w4.raw_val) <> ''

  UNION ALL

  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'residence_status' AS category_code,
         v.value_code AS tag_value_code, TRIM(d.residence_status) AS tag_value_name,
         CAST(NULL AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  LEFT JOIN weijia.dim_yx_house_tag_value v
    ON v.category_code = 'residence_status' AND v.value_name = TRIM(d.residence_status)
  WHERE d.house_code IS NOT NULL AND d.house_code <> ''
    AND d.residence_status IS NOT NULL AND TRIM(d.residence_status) <> ''

  UNION ALL

  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'decorate_status' AS category_code,
         v.value_code AS tag_value_code, TRIM(d.decorate_status) AS tag_value_name,
         CAST(NULL AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  LEFT JOIN weijia.dim_yx_house_tag_value v
    ON v.category_code = 'decorate_status' AND v.value_name = TRIM(d.decorate_status)
  WHERE d.house_code IS NOT NULL AND d.house_code <> ''
    AND d.decorate_status IS NOT NULL AND TRIM(d.decorate_status) <> ''

  UNION ALL

  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'family_structure' AS category_code,
         v.value_code AS tag_value_code, TRIM(d.family_structure) AS tag_value_name,
         CAST(NULL AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  LEFT JOIN weijia.dim_yx_house_tag_value v
    ON v.category_code = 'family_structure' AND v.value_name = TRIM(d.family_structure)
  WHERE d.house_code IS NOT NULL AND d.house_code <> ''
    AND d.family_structure IS NOT NULL AND TRIM(d.family_structure) <> ''

  UNION ALL

  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'price_sensitivity' AS category_code,
         CAST(NULL AS STRING) AS tag_value_code, TRIM(d.price_sensitivity_label) AS tag_value_name,
         CAST(NULL AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  WHERE d.house_code IS NOT NULL AND d.house_code <> ''
    AND d.price_sensitivity_label IS NOT NULL AND TRIM(d.price_sensitivity_label) <> ''

  UNION ALL

  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'house_type' AS category_code,
         CAST(NULL AS STRING) AS tag_value_code, TRIM(d.house_type_name) AS tag_value_name,
         CAST(NULL AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  WHERE d.house_code IS NOT NULL AND d.house_code <> ''
    AND d.house_type_name IS NOT NULL AND TRIM(d.house_type_name) <> ''

  UNION ALL

  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'layout' AS category_code,
         CAST(NULL AS STRING) AS tag_value_code, TRIM(d.layout) AS tag_value_name,
         CAST(NULL AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  WHERE d.house_code IS NOT NULL AND d.house_code <> ''
    AND d.layout IS NOT NULL AND TRIM(d.layout) <> ''

  UNION ALL

  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'house_age' AS category_code,
         CAST(NULL AS STRING) AS tag_value_code, CAST(NULL AS STRING) AS tag_value_name,
         CAST(d.deliver_year AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  WHERE d.house_code IS NOT NULL AND d.house_code <> '' AND d.deliver_year IS NOT NULL

  UNION ALL

  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'property_area' AS category_code,
         CAST(NULL AS STRING) AS tag_value_code, CAST(NULL AS STRING) AS tag_value_name,
         CAST(d.property_area AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  WHERE d.house_code IS NOT NULL AND d.house_code <> '' AND d.property_area IS NOT NULL

  UNION ALL

  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'kitchen_repair' AS category_code,
         CAST(NULL AS STRING) AS tag_value_code, CAST(NULL AS STRING) AS tag_value_name,
         CAST(COALESCE(d.kitchen_repair, 0) AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  WHERE d.house_code IS NOT NULL AND d.house_code <> ''

  UNION ALL

  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'balcony_repair' AS category_code,
         CAST(NULL AS STRING) AS tag_value_code, CAST(NULL AS STRING) AS tag_value_name,
         CAST(COALESCE(d.balcony_repair, 0) AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  WHERE d.house_code IS NOT NULL AND d.house_code <> ''

  UNION ALL

  SELECT d.house_code, d.code AS house_pride_code, d.region_name, d.city_group_name,
         d.asset_code, d.asset_name, 'bathroom_repair' AS category_code,
         CAST(NULL AS STRING) AS tag_value_code, CAST(NULL AS STRING) AS tag_value_name,
         CAST(COALESCE(d.bathroom_repair, 0) AS DECIMAL(38,4)) AS tag_value_num
  FROM weijia.dwd_yanxuan_responsible_project_hosue_label d
  WHERE d.house_code IS NOT NULL AND d.house_code <> ''
) all_tag;

-- C. PostgreSQL / RDS：房屋明细查询表（项目已有 house_label_snapshot，DDL 与现有 Prisma 模型对齐）
-- 一房一行，标签以 JSONB 保存；前端不直接扫描全量数据，后端按产品规则筛选、分页返回。
CREATE TABLE IF NOT EXISTS house_label_snapshot (
  id BIGSERIAL PRIMARY KEY,
  house_id VARCHAR(64) NOT NULL UNIQUE,
  zhantu_house_id VARCHAR(64),
  house_name TEXT,
  community_id VARCHAR(64),
  community_name TEXT,
  region TEXT,
  city TEXT,
  branch TEXT,
  station TEXT,
  station_code TEXT,
  owner_name_masked TEXT,
  contact_mobile_enc TEXT,
  customer_key_hash VARCHAR(128),
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  stat_date DATE NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  label_version VARCHAR(32) NOT NULL DEFAULT 'v1'
);
COMMENT ON COLUMN house_label_snapshot.house_id IS 'Pride 房屋编码，应用系统房屋主键';
COMMENT ON COLUMN house_label_snapshot.zhantu_house_id IS '战图房屋编码，备用关联键';
COMMENT ON COLUMN house_label_snapshot.labels IS '动态 JSONB 标签，如水路多值数组、装修状态字符串、房龄/面积数值';
CREATE INDEX IF NOT EXISTS idx_hls_city_community ON house_label_snapshot(city, community_id);
CREATE INDEX IF NOT EXISTS idx_hls_org_scope ON house_label_snapshot(region, city, branch, station);
CREATE INDEX IF NOT EXISTS idx_hls_labels_gin ON house_label_snapshot USING GIN (labels jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_hls_label_date ON house_label_snapshot(stat_date);

-- D. 从 PostgreSQL staging 写入/更新房屋明细。
-- 当前仓库的正式实现为 HouseSyncService.mergeHouseLabels() 批量 upsert；
-- 本 SQL 用于说明映射契约/数据核对，不要与服务层并行双写。
INSERT INTO house_label_snapshot (
  house_id, zhantu_house_id, house_name, community_id, community_name,
  region, city, branch, station, station_code, labels, stat_date, synced_at, label_version
)
SELECT
  s.house_id,
  s.zhantu_house_id,
  s.house_name,
  s.community_id,
  s.community_name,
  s.region,
  s.city,
  s.branch,
  s.station,
  s.station_code,
  jsonb_strip_nulls(jsonb_build_object(
    'water_tags', CASE WHEN NULLIF(BTRIM(s.water_tags_raw), '') IS NOT NULL
      THEN to_jsonb(regexp_split_to_array(BTRIM(s.water_tags_raw), '\s*,\s*')) END,
    'electric_tags', CASE WHEN NULLIF(BTRIM(s.electric_tags_raw), '') IS NOT NULL
      THEN to_jsonb(regexp_split_to_array(BTRIM(s.electric_tags_raw), '\s*,\s*')) END,
    'appliance_tags', CASE WHEN NULLIF(BTRIM(s.appliance_tags_raw), '') IS NOT NULL
      THEN to_jsonb(regexp_split_to_array(BTRIM(s.appliance_tags_raw), '\s*,\s*')) END,
    'env_tags', CASE WHEN NULLIF(BTRIM(s.env_tags_raw), '') IS NOT NULL
      THEN to_jsonb(regexp_split_to_array(BTRIM(s.env_tags_raw), '\s*,\s*')) END,
    'price_sensitivity', to_jsonb(NULLIF(BTRIM(s.price_sensitivity), '')),
    'residence_status', to_jsonb(NULLIF(BTRIM(s.residence_status), '')),
    'family_structure', to_jsonb(NULLIF(BTRIM(s.family_structure), '')),
    'decorate_status', to_jsonb(NULLIF(BTRIM(s.decorate_status), '')),
    'house_type_name', to_jsonb(NULLIF(BTRIM(s.house_type_name), '')),
    'deliver_year', to_jsonb(s.deliver_year),
    'property_area', to_jsonb(s.property_area),
    'layout', to_jsonb(NULLIF(BTRIM(s.layout), '')),
    'repair_kitchen', CASE WHEN s.repair_kitchen > 0 THEN to_jsonb(s.repair_kitchen) END,
    'repair_balcony', CASE WHEN s.repair_balcony > 0 THEN to_jsonb(s.repair_balcony) END,
    'repair_bathroom', CASE WHEN s.repair_bathroom > 0 THEN to_jsonb(s.repair_bathroom) END
  )) AS labels,
  s.stat_date,
  now(),
  'v1'
FROM house_label_staging s
WHERE s.stat_date = DATE '${bizdate}'
ON CONFLICT (house_id) DO UPDATE SET
  zhantu_house_id = EXCLUDED.zhantu_house_id,
  house_name = EXCLUDED.house_name,
  community_id = EXCLUDED.community_id,
  community_name = EXCLUDED.community_name,
  region = EXCLUDED.region,
  city = EXCLUDED.city,
  branch = EXCLUDED.branch,
  station = EXCLUDED.station,
  station_code = EXCLUDED.station_code,
  labels = EXCLUDED.labels,
  stat_date = EXCLUDED.stat_date,
  synced_at = EXCLUDED.synced_at,
  label_version = EXCLUDED.label_version;

