-- =================================================================================
-- 02_catalog_seed.sql
-- 产品包 + 产品包明细 + 互斥组 初始化种子（PostgreSQL 16）
-- 事实源：资料/映射关系.md + 三张真实营销海报（资料/*.jpg）+ docs/DATA-CONTRACT.md §4.3
-- 幂等，可重复执行。
-- 产品包一期共 3 个（业务方当前真实在推的营销产品）：
--   PKG-SEEP        渗漏检测包（防水补漏 / 东方雨虹）
--   PKG-TUB2SHOWER  浴改淋包（浴缸秒变淋浴）
--   PKG-REFRESH     墙面刷新包（PPG 大师漆）
-- =================================================================================

-- ----------------------------- 产品包主表 -----------------------------
INSERT INTO product_package (code, name, description, status, product_items_text) VALUES
('PKG-SEEP',
 '渗漏检测包',
 '针对卫生间/厨房/阳台漏水与水管老化房屋的免费渗漏检测与防水补漏服务。防水隐患优先于美观类翻新。',
 'enabled',
 '东方雨虹200柔韧型防水涂料；淋浴区防水≥1.8m；72小时闭水试验；深层渗透修复；快速施工省时；防水质保10年；万科物业自营，不达标砸了重来'),
('PKG-TUB2SHOWER',
 '浴改淋包',
 '针对带浴缸、多成员家庭的「浴缸秒变淋浴」局部改造，立省1㎡，干湿分离，不搬家施工。',
 'enabled',
 '浴缸拆除改淋浴房；干湿分离玻璃隔断；壁龛浴室柜补收纳，空间利用翻倍；万科物业自营；超期按天赔付；不搬家施工'),
('PKG-REFRESH',
 '墙面刷新包',
 '针对墙面发霉、开裂起皮、空鼓脱落、污渍难擦的旧房墙面刷新，环保净味涂料，标准化施工。',
 'enabled',
 'PPG大师漆（环保等级、遮盖力远超国标）；精细保护；腻子精修；净味涂料；根源阻断霉斑、墙面持久洁净；标准化施工、自有工人；精选环保漆安心入住')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    product_items_text = EXCLUDED.product_items_text;

-- ----------------------------- 产品包卖点明细（海报变量来源） -----------------------------
-- 业务唯一约束：同一产品包下产品名唯一（架构 §6（2）原仅普通索引，幂等种子需要）
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_package_item_name
  ON product_package_item (package_id, item_name);

WITH p AS (SELECT id, code FROM product_package)
INSERT INTO product_package_item (package_id, item_name, item_desc, sort_order)
SELECT p.id, v.item_name, v.item_desc, v.sort_order
FROM (
  VALUES
    ('PKG-SEEP',       '免费渗漏检测', '扫码预约，专业上门检测渗漏点', 1),
    ('PKG-SEEP',       '东方雨虹200',  '柔韧型防水涂料，淋浴区防水≥1.8m，72小时闭水试验', 2),
    ('PKG-SEEP',       '防水质保10年', '万科物业自营，不达标砸了重来', 3),
    ('PKG-TUB2SHOWER', '浴缸秒变淋浴', '立省1㎡，干湿分离，小改造大改变', 1),
    ('PKG-TUB2SHOWER', '壁龛浴室柜',   '补收纳，空间利用翻倍', 2),
    ('PKG-TUB2SHOWER', '不搬家施工',   '万科物业自营，超期按天赔付', 3),
    ('PKG-REFRESH',    'PPG大师漆',    '环保等级与遮盖力远超国标', 1),
    ('PKG-REFRESH',    '三道标准工艺', '精细保护 → 腻子精修 → 净味涂料，根源阻断霉斑', 2),
    ('PKG-REFRESH',    '环保安心入住', '标准化施工、自有工人、精选环保漆', 3)
) AS v(pkg_code, item_name, item_desc, sort_order)
JOIN p ON p.code = v.pkg_code
ON CONFLICT (package_id, item_name) DO UPDATE
SET item_desc  = EXCLUDED.item_desc,
    sort_order = EXCLUDED.sort_order;

-- ----------------------------- 互斥组（单包输出，mode 固定 single） -----------------------------
-- 业务唯一约束：互斥组名唯一（架构 §6（5）未建，幂等种子需要）
CREATE UNIQUE INDEX IF NOT EXISTS uq_mutex_group_name ON mutex_group (name);

INSERT INTO mutex_group (name, mode, status) VALUES
('居家改造类互斥组', 'single', 'enabled')
ON CONFLICT (name) DO UPDATE
SET mode   = EXCLUDED.mode,
    status = EXCLUDED.status;

-- 组说明：渗漏/浴改淋/刷新同属一个房屋周期内的居家改造触达。
-- 单包输出（PRD §5.4 已裁决）：同一房屋同周期命中多包时，
-- 先在组内按 priority 升序收敛为唯一一包（数值越小优先级越高）。
-- 优先级业务含义：安全隐患（渗漏）> 功能改造（浴改淋）> 美观翻新（刷新），
-- 该顺序仅为初版建议，营销管理岗可在后台拖拽调整。

-- 运维查询：产品包与互斥组核对
-- SELECT pp.code, pp.name, pp.status, mg.name AS mutex_group
-- FROM product_package pp
-- LEFT JOIN mapping_rule mr ON mr.package_id = pp.id
-- LEFT JOIN mutex_group mg ON mg.id = mr.mutex_group_id
-- ORDER BY pp.code;
