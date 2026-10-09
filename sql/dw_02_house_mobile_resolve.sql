-- =================================================================================
-- dw_02_house_mobile_resolve.sql
-- DataWorks 数据集成 · 节点①b 业主手机号补号查询（ADB PostgreSQL Reader 侧 SQL）
-- 目标：RDS PostgreSQL 暂存表 house_mobile_resolve_staging
--       （house_id pride码 / mobile_raw 明文临时列 / mobile_source / is_preferred）
-- 背景：标签宽表 weijia.dwd_yanxuan_responsible_project_hosue_label 不含任何联系方式
--       （DATA-CONTRACT GAP-1），下发号码必须另行补全。
-- 号码源与优先级（满盘营销脚本已验证的取数链路）：
--   1) rich  住这儿注册手机号（实名业主，质量最高，关联 pride code）
--   2) qywx  企微外部联系人（PA 已加微，经手机号回连住儿房屋）
-- 合规：明文手机号只允许出现在 ADB 查询与同步管道中；
--       RDS merge 作业生成 密文(contact_mobile_enc) + HMAC(customer_key_hash) 后
--       必须清空 staging 明文列；本系统界面只展示脱敏号。
-- 方言：ADB PostgreSQL（与 PostgreSQL 语法兼容；CTE + 窗口函数）
-- =================================================================================

WITH rich_src AS (
    -- 源1：住这儿 用户-房屋-手机号
    SELECT uh.house_code,
           up.phone AS mobile_raw,
           'rich'   AS mobile_source,
           1        AS src_priority
    FROM meiju.ods_rich_rich_user_house uh
    JOIN meiju.ods_rich_rich_user_phone up
      ON up.user_code = uh.user_code
    WHERE uh.is_deleted = 0
      AND up.is_deleted = 0
      AND uh.house_code IS NOT NULL AND uh.house_code <> ''
      AND up.phone IS NOT NULL AND btrim(up.phone) <> ''
),
qywx_src AS (
    -- 源2：企微外部联系人（remark_mobiles 可能逗号多号，拆开后回连住儿房屋）
    SELECT uh.house_code,
           t.mobile_raw,
           'qywx' AS mobile_source,
           2      AS src_priority
    FROM caster.cas_qywx_customer_member_rel cmr
    JOIN caster.cas_qywx_customer_info ci
      ON cmr.external_user_id = ci.external_user_id
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(cmr.remark_mobiles, ''), ',') AS r(m)
    CROSS JOIN LATERAL (
        SELECT COALESCE(ci.weijia_user_match_mobile, NULLIF(btrim(r.m), '')) AS mobile_raw
    ) t
    JOIN meiju.ods_rich_rich_user_house uh
      ON uh.phone = t.mobile_raw AND uh.is_deleted = 0
    WHERE (ci.weijia_user_match_mobile IS NOT NULL OR cmr.remark_mobiles IS NOT NULL)
      AND t.mobile_raw IS NOT NULL AND btrim(t.mobile_raw) <> ''
),
all_src AS (
    SELECT house_code, mobile_raw, mobile_source, src_priority FROM rich_src
    UNION ALL
    SELECT house_code, mobile_raw, mobile_source, src_priority FROM qywx_src
),
norm AS (
    -- 仅做轻量清洗（trim/去空格连字符）；HMAC 归一化（去+86前缀等）与哈希由 RDS 侧统一完成
    SELECT house_code,
           regexp_replace(btrim(mobile_raw), '[\s-]', '', 'g') AS mobile_raw,
           mobile_source,
           src_priority,
           ROW_NUMBER() OVER (
               PARTITION BY house_code, regexp_replace(btrim(mobile_raw), '[\s-]', '', 'g')
               ORDER BY src_priority
           ) AS dedup_rn
    FROM all_src
),
pick AS (
    SELECT house_code, mobile_raw, mobile_source, src_priority,
           ROW_NUMBER() OVER (PARTITION BY house_code ORDER BY src_priority, mobile_raw) AS pick_rn
    FROM norm
    WHERE dedup_rn = 1
)
SELECT
    house_code        AS house_id,           -- pride 房屋编码（= 标签宽表 code）
    mobile_raw,                              -- 明文（仅传输，merge 后清空）
    mobile_source,                           -- rich / qywx
    CASE WHEN pick_rn = 1 THEN true ELSE false END AS is_preferred
FROM pick
;

-- merge 后覆盖率核查（DATA-CONTRACT §8 Q1）：
-- SELECT COUNT(*) AS total_house,
--        COUNT(m.mobile_raw) AS mobile_house,
--        ROUND(COUNT(m.mobile_raw)::numeric / NULLIF(COUNT(*),0), 4) AS coverage
-- FROM house_label_snapshot s
-- LEFT JOIN (SELECT house_id, mobile_raw FROM house_mobile_resolve WHERE is_preferred) m
--   ON m.house_id = s.house_id;
-- 上线门槛：coverage >= 0.70；低于门槛只允许跑规则/预览，不允许开启发送。
