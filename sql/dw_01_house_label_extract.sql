-- =================================================================================
-- dw_01_house_label_extract.sql
-- DataWorks 数据集成 · 节点① 房屋标签抽取（MaxCompute Reader 侧查询 SQL）
-- 源表（只读）：weijia.dwd_yanxuan_responsible_project_hosue_label（T+1 全量覆写，约125.7万行）
-- 目标：RDS PostgreSQL 暂存表 house_label_staging（列名与本 SELECT 别名一一对应）
-- 后续：由本系统 merge 作业将 staging 拼装 labels JSONB、拆分多值标签后
--       upsert 进 house_label_snapshot（见后端 jobs/house-sync.merge 逻辑）。
-- 调度：每日 02:00；DataWorks 赋值参数 ${bizdate}（yyyymmdd）写入 stat_date。
-- 方言：MaxCompute SQL。不改造上游生产脚本，仅做读取映射。
-- =================================================================================

SELECT
    -- 标识与组织
    code                                        AS house_id,             -- pride 房屋编码（系统主键）
    house_code                                  AS zhantu_house_id,      -- 战图房屋编码（备用关联键）
    name                                        AS house_name,
    asset_code                                  AS community_id,
    asset_name                                  AS community_name,
    region_name                                 AS region,
    city_group_name                             AS city,
    business_name                               AS branch,
    fwz_org                                     AS station,
    fwz_org_code                                AS station_code,

    -- 多值标签：上游为 wm_concat 逗号拼接字符串，原样同步，由 merge 作业拆分为数组
    shuilu_label                                AS water_tags_raw,
    dianlu_tag                                  AS electric_tags_raw,
    jiadian_tag                                 AS appliance_tags_raw,
    envir_tag                                   AS env_tags_raw,

    -- 单值标签与属性
    price_sensitivity_label                     AS price_sensitivity,
    residence_status                            AS residence_status,
    family_structure                            AS family_structure,     -- 注意真实值带 A_~E_ 前缀
    decorate_status                             AS decorate_status,      -- 注意「未装修」为 ELSE 兜底，语义偏宽
    house_type_name                             AS house_type_name,
    deliver_year                                AS deliver_year,
    property_area                               AS property_area,
    layout                                      AS layout,

    -- 维修频次（近365天）
    COALESCE(kitchen_repair, 0)                 AS repair_kitchen,
    COALESCE(balcony_repair, 0)                 AS repair_balcony,
    COALESCE(bathroom_repair, 0)                AS repair_bathroom,

    -- 同步元数据（调度业务日期；源表无分区字段，由同步节点打标）
    TO_DATE('${bizdate}', 'yyyymmdd')           AS stat_date
FROM weijia.dwd_yanxuan_responsible_project_hosue_label
WHERE code IS NOT NULL
;

-- =================================================================================
-- 同步后 merge 作业（在 RDS PostgreSQL 执行，由本系统跑批编排调用；示意逻辑）
-- =================================================================================
-- INSERT INTO house_label_snapshot
--   (house_id, zhantu_house_id, house_name, community_id, community_name,
--    region, city, branch, station, station_code, labels, stat_date, synced_at)
-- SELECT
--   house_id, zhantu_house_id, house_name, community_id, community_name,
--   region, city, branch, station, station_code,
--   jsonb_strip_nulls(jsonb_build_object(
--     'water_tags',     string_to_array(NULLIF(water_tags_raw,''), ','),
--     'electric_tags',  string_to_array(NULLIF(electric_tags_raw,''), ','),
--     'appliance_tags', string_to_array(NULLIF(appliance_tags_raw,''), ','),
--     'env_tags',       string_to_array(NULLIF(env_tags_raw,''), ','),
--     'price_sensitivity', price_sensitivity,
--     'residence_status',  residence_status,
--     'family_structure',  family_structure,
--     'decorate_status',   decorate_status,
--     'house_type_name',   house_type_name,
--     'deliver_year',      deliver_year,
--     'property_area',     property_area,
--     'layout',            layout,
--     'repair_kitchen',    repair_kitchen,
--     'repair_balcony',    repair_balcony,
--     'repair_bathroom',   repair_bathroom)),
--   stat_date, now()
-- FROM house_label_staging
-- ON CONFLICT (house_id) DO UPDATE SET ...;

-- 数据质量校验（merge 后必跑，对齐项目既有「归档前质检」惯例）：
-- 1) 行数环比偏差 >30% 告警；2) 组织五字段为空的房屋数；3) 多值标签拆分后空值率。
