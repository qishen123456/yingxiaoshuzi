-- =================================================================================
-- dw_03_lead_extract.sql
-- DataWorks 数据集成 · 节点② 线索抽取（ADB PostgreSQL Reader 侧查询 SQL）
-- 源表（只读）：yanxuan.ads_yx_clue_full_detail（T+1 TRUNCATE+INSERT 全量快照，约180列）
-- 目标：RDS PostgreSQL 暂存表 lead_record_staging（列名与本 SELECT 别名一一对应）
-- 后续：本系统 merge 作业 upsert 进 lead_record（lead_id 幂等，不覆盖归因回填字段）。
-- 同步策略（DATA-CONTRACT §4.4）：
--   1) 同步层只排除测试数据 is_test=true；业务口径过滤全部下沉指标层，不在同步时做；
--   2) 责任盘：is_responsibility=true（标签快照进来的天然都是责任盘）；
--   3) 明文手机号只在管道出现，RDS 侧 merge 时算 HMAC（密钥不下放 ADB）后清空明文列；
--   4) 源端每日全量重灌，目标端 upsert 不物理删除；消失线索由 merge 打 stale 标记。
-- 方言：ADB PostgreSQL。调度：每日 02:30；参数 ${bizdate}（yyyymmdd）。
-- =================================================================================

SELECT
    clue_id                                     AS lead_id,

    -- 客户键：此处仅做归一化前的轻度清洗与来源判定；HMAC-SHA256 在 RDS merge 作业统一完成
    -- （归一化规则：去空格/连字符、去 +86/86 前缀；customer_key 与 push_detail.customer_key_hash
    --   必须同算法同密钥，见 ADR-013，否则闸门0与归因全部失效）
    customer_mobile                             AS mobile_raw,
    CASE
        WHEN customer_mobile IS NOT NULL AND btrim(customer_mobile) <> '' THEN 'mobile_hash'
        WHEN house_code IS NOT NULL AND btrim(house_code) <> ''          THEN 'house_only'
        ELSE 'unmatched'
    END                                         AS customer_key_type,

    -- 房屋双键：pride 优先，空则回落战图码（回落命中由 merge 作业打 house_match_type=zhantu_fallback）
    NULLIF(btrim(house_code), '')               AS house_id_pride,
    NULLIF(btrim(zhantu_housecode), '')         AS house_id_zhantu,
    project_code                                AS project_code,
    servicestation_code                         AS servicestation_code,

    -- 产品包外部编码：一级|二级原样留存；二级枚举上线前必须先盘点（DATA-CONTRACT GAP-3）
    CASE
        WHEN intention_second_type IS NOT NULL AND btrim(intention_second_type) <> ''
            THEN concat(intention_first_type, '|', intention_second_type)
        ELSE intention_first_type
    END                                         AS external_package_code,
    intention_type                              AS intention_type,        -- 自营/美居/其他
    intention_first_type                        AS intention_first_type,  -- 归一化四值：全屋整装/局部改造/单品焕新/家政维修
    intention_second_type                       AS intention_second_type, -- 待盘点（GAP-3）
    is_repair                                   AS is_repair,             -- 是/否（维修向口径基准，勿在同步层过滤）

    -- 质量字段：等级/状态原样保存（动态枚举不翻译），另派生统一四级质量 lead_quality
    customer_level                              AS lead_grade_raw,        -- A类客户~E类客户
    business_status                             AS lead_status_raw,
    -- 四级质量翻译（DATA-CONTRACT §4.2，与公司「有效线索」统一口径对齐，写死不进配置）
    -- 优先级自上而下短路：已成交 > 有效口径A > 有效口径B/C > 无效
    CASE
        WHEN business_status = '已成交' THEN 'A'
        WHEN intention_type = '自营'
             AND is_repair = '否'
             AND intention_first_type <> '家政维修'
             AND business_status NOT IN ('其他','无需求','待清洗')
             AND customer_level = 'A类客户' THEN 'A'
        WHEN intention_type = '自营'
             AND is_repair = '否'
             AND intention_first_type <> '家政维修'
             AND business_status NOT IN ('其他','无需求','待清洗')
             AND customer_level IN ('B类客户','C类客户') THEN 'B'
        WHEN intention_type = '自营'
             AND is_repair = '否'
             AND intention_first_type <> '家政维修'
             AND business_status NOT IN ('其他','无需求','待清洗')
             AND (customer_level IN ('D类客户','E类客户') OR customer_level IS NULL) THEN 'C'
        ELSE '无效'
    END                                         AS lead_quality,
    -- 装修向有效线索标记（刷新/浴改淋指标用，严格口径）
    (intention_type = '自营'
        AND is_repair = '否'
        AND intention_first_type <> '家政维修'
        AND business_status NOT IN ('其他','无需求','待清洗')) AS is_valid_for_reno,
    -- 维修向有效线索标记（渗漏包指标用，口径相反：is_repair='是'）
    (is_repair = '是')                          AS is_valid_for_repair,

    channel_category_l1                         AS source_channel,

    -- 时间与成交信号（成交是最高质量信号；成交三列目标表需扩展，见 ARCHITECTURE 闭环变更）
    created_time                                AS lead_created_at,
    latest_deal_time                            AS latest_deal_at,
    COALESCE(order_cnt, 0)                       AS order_cnt,
    performance_final                           AS performance_amount,

    TO_DATE('${bizdate}', 'yyyymmdd')           AS stat_date
FROM yanxuan.ads_yx_clue_full_detail
WHERE is_test = false
  AND is_responsibility = true
  AND clue_id IS NOT NULL
;

-- =================================================================================
-- merge 作业要点（RDS PostgreSQL，系统跑批编排调用）：
-- 1) customer_key = HMAC_SHA256(normalize(mobile_raw), 配置中心密钥)；mobile_raw 用后清空；
-- 2) house_id 取 house_id_pride，为空且 house_id_zhantu 命中标签快照时回落并打标；
-- 3) product_package_id/package_source 按 DATA-CONTRACT §4.3 词表判定：
--    external（命中字典）→ inferred（归因首触推断）→ none（拆「有码对不上/无码」两子口径）；
-- 4) ON CONFLICT (lead_id) DO UPDATE 只更新外部字段，
--    不覆盖 first_touch_push_id/last_touch_push_id/attributed_at/attribution_window_days；
-- 5) 新鲜度校验：max(synced_at) 滞后 > 2 天 → 闸门0 fail-open + 告警（lead_gate_fail_mode='open'）。
--
-- 上线前必跑：DATA-CONTRACT §8 Q3（二级意向盘点）、Q5（双键+手机号覆盖率）。
-- =================================================================================
