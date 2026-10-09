-- =================================================================================
-- 0924 营销客群筛选（东莞金域松湖 / 深圳第五园）—— 渗漏 + 浴改淋
-- ---------------------------------------------------------------------------------
-- 客群规则（未装修为两个产品的共同必选条件，口径对齐 0924标签.sql）:
--   ▶ 渗漏:
--       水路标签命中任一: 卫生间漏水 / 水管老化 / 阳台漏水 / 厨房漏水
--       (shuilu_label 为 wm_concat 多值拼接, 用 RLIKE 命中即可)
--   ▶ 浴改淋（以下两组标签命中任一组即可）:
--       1. 环境标签 envir_tag 命中任一: 瓷砖开裂空鼓 / 墙面发霉 / 渗水返潮
--          (注意落表实际值为「渗水/返潮」带斜杠, RLIKE 用 渗水.返潮 兼容)
--       2. 家庭结构 family_structure 属于: A_三代同堂 / B_多孩之家 / C_二孩之家 / D_三口之家
--   两个产品条件为「或」关系; 同一户同时命中时 product_tag = '渗漏,浴改淋'。
--
-- 号码口径（每户仅取 1 个最高优先级号码）:
--   源表 vs5space.dwd_phone_housecode_relation 为 crm+center+zze 多来源历史人房关系全量表,
--   一套房存在多个号码（业主/家属/租客/历史联系人, 单屋历史号码最多数十个）。
--   ① 仅保留 11 位大陆手机号（1 开头）且关系类型为「业主/家属」，剔除租赁、其他、空号、固话；
--   ② 每户 ROW_NUMBER 排序只取 rn=1: 关系「业主 > 家属」优先, 关系相同时来源「crm > center > zze」优先;
--   ③ 拨号清单按号码去重, 一个号码只出现一次(关联多套房时房号串接, 合并拨打)。
--
-- 关联键: 标签表 house_code（战图房屋编码） = 号码表 asset_id
-- 方言: MaxCompute SQL（DataWorks 直接执行）
-- =================================================================================

WITH target AS (
    -- 目标客群: 两项目 + 未装修(必选) + (渗漏 或 浴改淋)
    SELECT
        asset_name,
        city_group_name,
        fwz_org,
        code        AS pride_code,      -- pride 房屋编码（CN 开头）
        house_code  AS zhantu_code,     -- 战图房屋编码（关联号码表用）
        name        AS house_name,
        shuilu_label,
        envir_tag   AS envir_label,
        family_structure,
        CASE
            WHEN shuilu_label RLIKE '卫生间漏水|水管老化|阳台漏水|厨房漏水'
             AND (
                    envir_tag RLIKE '瓷砖开裂空鼓|墙面发霉|渗水.返潮'
                 OR family_structure IN ('A_三代同堂', 'B_多孩之家', 'C_二孩之家', 'D_三口之家')
                 )
                THEN '渗漏,浴改淋'
            WHEN shuilu_label RLIKE '卫生间漏水|水管老化|阳台漏水|厨房漏水'
                THEN '渗漏'
            ELSE '浴改淋'
        END AS product_tag
    FROM weijia.dwd_yanxuan_responsible_project_hosue_label
    WHERE asset_name IN ('东莞金域松湖', '深圳第五园')
      AND decorate_status = '未装修'
      AND (
            shuilu_label RLIKE '卫生间漏水|水管老化|阳台漏水|厨房漏水'
         OR envir_tag RLIKE '瓷砖开裂空鼓|墙面发霉|渗水.返潮'
         OR family_structure IN ('A_三代同堂', 'B_多孩之家', 'C_二孩之家', 'D_三口之家')
          )
),
phone_dedup AS (
    -- 11 位手机号 + 业主/家属; 同房同号跨来源保留全部(来源用于优先级排序)
    SELECT DISTINCT asset_id, phone, relationtype_name, data_sys
    FROM vs5space.dwd_phone_housecode_relation
    WHERE phone RLIKE '^1[0-9]{10}$'
      AND relationtype_name IN ('业主', '家属')
),
phone_pick AS (
    -- 每户按「业主 > 家属」「crm > center > zze」只保留 1 个最高优先级号码
    SELECT asset_id, phone, relationtype_name, data_sys
    FROM (
        SELECT
            asset_id, phone, relationtype_name, data_sys,
            ROW_NUMBER() OVER (
                PARTITION BY asset_id
                ORDER BY
                    CASE relationtype_name WHEN '业主' THEN 1 WHEN '家属' THEN 2 END,
                    CASE WHEN data_sys LIKE '%crm%' THEN 1
                         WHEN data_sys LIKE '%center%' THEN 2
                         ELSE 3 END,
                    phone
            ) AS rn
        FROM phone_dedup
    ) r
    WHERE rn = 1
)

-- ============================== 结果一: 房屋明细清单（每户 1 个主叫号码） ==============================
SELECT
    t.asset_name                                        AS 项目,
    t.city_group_name                                   AS 城市分公司,
    t.fwz_org                                           AS 服务站,
    t.house_name                                        AS 房号,
    t.pride_code                                        AS pride房屋编码,
    t.zhantu_code                                       AS 战图房屋编码,
    t.product_tag                                       AS 命中产品,
    t.shuilu_label                                      AS 水路标签,
    t.envir_label                                       AS 环境标签,
    t.family_structure                                  AS 家庭结构,
    p.phone                                             AS 主叫号码,
    p.relationtype_name                                 AS 号码关系,
    p.data_sys                                          AS 号码来源
FROM target t
LEFT JOIN phone_pick p ON p.asset_id = t.zhantu_code
ORDER BY 项目, 命中产品, 房号
;

-- ============================== 结果二: 电话粒度去重拨号清单（一个号码只发一次） ==============================
WITH target AS (
    SELECT asset_name, code AS pride_code, house_code AS zhantu_code, name AS house_name,
           shuilu_label, envir_tag, family_structure,
        CASE
            WHEN shuilu_label RLIKE '卫生间漏水|水管老化|阳台漏水|厨房漏水'
             AND (envir_tag RLIKE '瓷砖开裂空鼓|墙面发霉|渗水.返潮'
                  OR family_structure IN ('A_三代同堂','B_多孩之家','C_二孩之家','D_三口之家'))
                THEN '渗漏,浴改淋'
            WHEN shuilu_label RLIKE '卫生间漏水|水管老化|阳台漏水|厨房漏水' THEN '渗漏'
            ELSE '浴改淋'
        END AS product_tag
    FROM weijia.dwd_yanxuan_responsible_project_hosue_label
    WHERE asset_name IN ('东莞金域松湖','深圳第五园')
      AND decorate_status = '未装修'
      AND (
            shuilu_label RLIKE '卫生间漏水|水管老化|阳台漏水|厨房漏水'
         OR envir_tag RLIKE '瓷砖开裂空鼓|墙面发霉|渗水.返潮'
         OR family_structure IN ('A_三代同堂','B_多孩之家','C_二孩之家','D_三口之家')
          )
),
phone_pick AS (
    SELECT asset_id, phone, relationtype_name, data_sys
    FROM (
        SELECT asset_id, phone, relationtype_name, data_sys,
            ROW_NUMBER() OVER (
                PARTITION BY asset_id
                ORDER BY
                    CASE relationtype_name WHEN '业主' THEN 1 WHEN '家属' THEN 2 END,
                    CASE WHEN data_sys LIKE '%crm%' THEN 1
                         WHEN data_sys LIKE '%center%' THEN 2
                         ELSE 3 END,
                    phone
            ) AS rn
        FROM (
            SELECT DISTINCT asset_id, phone, relationtype_name, data_sys
            FROM vs5space.dwd_phone_housecode_relation
            WHERE phone RLIKE '^1[0-9]{10}$' AND relationtype_name IN ('业主','家属')
        ) d
    ) r
    WHERE rn = 1
)
SELECT
    t.asset_name                                            AS 项目,
    p.phone                                                 AS 主叫号码,
    MAX(p.relationtype_name)                                AS 号码关系,
    WM_CONCAT(DISTINCT ',', t.product_tag)                  AS 命中产品,
    COUNT(DISTINCT t.zhantu_code)                           AS 对应房屋套数,
    WM_CONCAT(',', t.house_name)                            AS 对应房号
FROM target t
JOIN phone_pick p ON p.asset_id = t.zhantu_code
GROUP BY t.asset_name, p.phone
ORDER BY 项目, 对应房屋套数 DESC, 主叫号码
;

-- ============================== 结果三: 分项目分产品汇总（执行后先核数） ==============================
-- SELECT asset_name AS 项目, product_tag AS 命中产品, COUNT(1) AS 户数
-- FROM (
--     SELECT asset_name,
--            CASE
--                WHEN shuilu_label RLIKE '卫生间漏水|水管老化|阳台漏水|厨房漏水'
--                 AND (envir_tag RLIKE '瓷砖开裂空鼓|墙面发霉|渗水.返潮'
--                      OR family_structure IN ('A_三代同堂','B_多孩之家','C_二孩之家','D_三口之家'))
--                    THEN '渗漏,浴改淋'
--                WHEN shuilu_label RLIKE '卫生间漏水|水管老化|阳台漏水|厨房漏水' THEN '渗漏'
--                ELSE '浴改淋'
--            END AS product_tag
--     FROM weijia.dwd_yanxuan_responsible_project_hosue_label
--     WHERE asset_name IN ('东莞金域松湖','深圳第五园') AND decorate_status='未装修'
--       AND (shuilu_label RLIKE '卫生间漏水|水管老化|阳台漏水|厨房漏水'
--            OR envir_tag RLIKE '瓷砖开裂空鼓|墙面发霉|渗水.返潮'
--            OR family_structure IN ('A_三代同堂','B_多孩之家','C_二孩之家','D_三口之家'))
-- ) z GROUP BY asset_name, product_tag ORDER BY 项目, 命中产品;
