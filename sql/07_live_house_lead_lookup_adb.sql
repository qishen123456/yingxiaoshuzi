-- =====================================================================================
-- sql/07_live_house_lead_lookup_adb.sql
-- 用途：房屋详情页打开时，按房屋编码查询既有线索明细。
-- 执行引擎：ADB PostgreSQL（查询源表，不在 RDS PostgreSQL 执行）。
-- 数据源：yanxuan.ads_yx_clue_full_detail（当前数据契约定义为 T+1 全量快照）。
--
-- 参数（由后端使用参数化查询绑定，不能由前端拼接 SQL）：
--   $1 = Pride 房屋编码（优先，通常来自 house_label_snapshot.house_id）
--   $2 = 战图房屋编码（兜底，来自 house_label_snapshot.zhantu_house_id）
--   $3 = page_size（默认20，最大100）
--   $4 = offset（默认0，必须 >= 0）
--
-- 关联原则：
--   1) 先按 Pride 编码 house_code 匹配；
--   2) 传入了战图编码时，同时允许 zhantu_housecode 兜底匹配；
--   3) 不按房屋名称/项目名称猜测关联；
--   4) 只查询当前请求房屋的线索，源表只读，不把线索字段写入房屋标签快照；
--   5) 本 SQL 不返回手机号、客户姓名等不必要的敏感字段。
--
-- 新鲜度注意：该 SQL 在用户打开详情时发起查询，但源表本身按当前契约是 T+1
-- 快照。若业务要求分钟级实时线索，需接入真正实时源表/接口，而不是只改本 SQL。
-- =====================================================================================

-- A. 查询房屋线索列表（使用后端 PostgreSQL 驱动绑定 $1-$4）。
SELECT
    clue_id                  AS lead_id,
    house_code               AS house_id_pride,
    zhantu_housecode         AS house_id_zhantu,
    project_code             AS project_code,
    servicestation_code      AS service_station_code,
    intention_type           AS intention_type,
    intention_first_type     AS intention_first_type,
    intention_second_type    AS intention_second_type,
    is_repair                AS is_repair,
    customer_level           AS customer_level,
    business_status          AS business_status,
    channel_category_l1      AS source_channel,
    created_time             AS lead_created_at,
    latest_deal_time         AS latest_deal_at,
    COALESCE(order_cnt, 0)   AS order_count,
    performance_final        AS performance_amount
FROM yanxuan.ads_yx_clue_full_detail
WHERE is_test = false
  AND is_responsibility = true
  AND clue_id IS NOT NULL
  AND (
        (
          NULLIF(btrim($1::text), '') IS NOT NULL
          AND btrim(COALESCE(house_code, '')) = btrim($1::text)
        )
        OR
        (
          NULLIF(btrim($2::text), '') IS NOT NULL
          AND btrim(COALESCE(zhantu_housecode, '')) = btrim($2::text)
        )
      )
ORDER BY created_time DESC NULLS LAST, clue_id DESC
LIMIT LEAST(GREATEST(COALESCE($3::integer, 20), 1), 100)
OFFSET GREATEST(COALESCE($4::integer, 0), 0);

-- B. 同一参数条件的总条数查询，用于前端分页总数。
-- 实现时将 A 查询中的 SELECT 字段替换为 COUNT(*)，WHERE 条件保持完全一致：
--
-- SELECT COUNT(*) AS total_count
-- FROM yanxuan.ads_yx_clue_full_detail
-- WHERE is_test = false
--   AND is_responsibility = true
--   AND clue_id IS NOT NULL
--   AND (
--         (NULLIF(btrim($1::text), '') IS NOT NULL
--          AND btrim(COALESCE(house_code, '')) = btrim($1::text))
--         OR
--         (NULLIF(btrim($2::text), '') IS NOT NULL
--          AND btrim(COALESCE(zhantu_housecode, '')) = btrim($2::text))
--       );

-- C. 后端接入建议：
-- 1) 前端只传 house_label_snapshot.house_id 或内部房屋 ID；
-- 2) 后端先读取该房屋的 house_id + zhantu_house_id，再执行本查询；
-- 3) 设置连接超时、查询超时、最大 page_size=100，并将访问记录写入审计日志；
-- 4) 当 ADB 查询失败时，返回“线索暂不可用”与错误追踪 ID，不要伪造空线索；
-- 5) 不将完整线索内容或手机号写入普通应用日志；
-- 6) 如现有网络架构禁止应用服务直接连 ADB，则由数据服务封装同等只读 API，
--    不应退回到从前端连接数据库。
