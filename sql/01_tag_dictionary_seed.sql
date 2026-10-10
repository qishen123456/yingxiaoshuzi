-- =================================================================================
-- 01_tag_dictionary_seed.sql
-- 标签字典初始化种子（PostgreSQL 16）
-- 事实源：docs/DATA-CONTRACT.md §3；上游生产脚本：资料/1.标签.sql（只读，不修改）
-- 说明：
--   1. 幂等，可重复执行（ON CONFLICT(tag_key) DO UPDATE）。
--   2. source_column 为上游 MaxCompute 真实列名（拼音），用于同步映射与问题溯源。
--   3. 多值标签 value_type='multi_enum'：上游为 wm_concat 逗号拼接字符串，
--      规则引擎用 contains_any / contains_all 操作符（拆分后包含匹配）。
--   4. 枚举值一律以上游生产 SQL 实际输出为准：
--      - 家庭结构带 A_~E_ 前缀（存储保留原值，界面展示去前缀）
--      - 环境标签真实值为「渗水/返潮」（带斜杠，非「渗水返潮」）
--   5. 执行顺序：先建表（见工程 Prisma 迁移）后执行本种子。
-- =================================================================================

-- 溯源列：架构 §6（3）原表无此列，字段级映射需要，随种子一并补齐
ALTER TABLE tag_dictionary ADD COLUMN IF NOT EXISTS source_column varchar(64);
COMMENT ON COLUMN tag_dictionary.source_column IS '上游数据源真实列名（MaxCompute 标签宽表拼音列），同步映射与溯源用';
ALTER TABLE tag_dictionary ADD COLUMN IF NOT EXISTS rule_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN tag_dictionary.rule_enabled IS '是否开放给产品规则搜索器；新类别默认开放，已有非核心类别默认关闭';

INSERT INTO tag_dictionary (tag_group, tag_key, tag_name, value_type, enum_values, min_value, max_value, source_column) VALUES
-- ==================== 维修标签（多值，逗号字符串） ====================
('water',     'water_tags',     '水路标签', 'multi_enum',
 '["卫生间漏水","厨房漏水","阳台漏水","水管老化"]'::jsonb, NULL, NULL, 'shuilu_label'),
('electric',  'electric_tags',  '电路标签', 'multi_enum',
 '["跳闸","插座故障","电路老化"]'::jsonb, NULL, NULL, 'dianlu_tag'),
('appliance', 'appliance_tags', '家电标签', 'multi_enum',
 '["空调故障","热水器故障","冰箱故障"]'::jsonb, NULL, NULL, 'jiadian_tag'),
('env',       'env_tags',       '环境标签', 'multi_enum',
 '["墙面发霉","渗水/返潮","厨房老化","卫生间老化","阳台老化","瓷砖开裂空鼓"]'::jsonb, NULL, NULL, 'envir_tag'),

-- ==================== 价格敏感（单值枚举，取值域待 DATA-CONTRACT §8 Q4 盘点） ====================
('price',     'price_sensitivity', '价格敏感标签', 'enum',
 '["性价比优先"]'::jsonb, NULL, NULL, 'price_sensitivity_label'),

-- ==================== 居住状态（单值枚举） ====================
('residence', 'residence_status', '居住状态', 'enum',
 '["未知","自住-常住","自住-非常住","出租中","空置"]'::jsonb, NULL, NULL, 'residence_status'),

-- ==================== 家庭结构（单值枚举，真实值带 A_~E_ 前缀） ====================
('family',    'family_structure', '家庭结构', 'enum',
 '["A_三代同堂","B_多孩之家","C_二孩之家","D_三口之家","E_二人世界"]'::jsonb, NULL, NULL, 'family_structure'),

-- ==================== 装修状态（单值枚举；「未装修」为 CASE ELSE 兜底，语义偏宽） ====================
('decoration','decorate_status', '装修状态', 'enum',
 '["未装修","一年以内","1-5年","5-10年","10年及以上"]'::jsonb, NULL, NULL, 'decorate_status'),

-- ==================== 维修频次（数值，近365天命中次数） ====================
('repair',    'repair_kitchen',   '厨房维修次数', 'number', NULL, 0, NULL, 'kitchen_repair'),
('repair',    'repair_balcony',   '阳台维修次数', 'number', NULL, 0, NULL, 'balcony_repair'),
('repair',    'repair_bathroom',  '卫生间维修次数','number', NULL, 0, NULL, 'bathroom_repair'),

-- ==================== 房屋属性 ====================
('house',     'house_type_name',  '房屋类型', 'string', NULL, NULL, NULL, 'house_type_name'),
('house',     'deliver_year',     '房屋年限（年）', 'number', NULL, 0, 100, 'deliver_year'),
('house',     'property_area',    '建筑面积（㎡）', 'number', NULL, 0, NULL, 'property_area'),
('house',     'layout',           '户型', 'string', NULL, NULL, NULL, 'layout'),

-- ==================== 房屋特征（GAP-2：上游暂无该列，浴改淋规则依赖，数据接入前规则保持 draft） ====================
('house',     'house_feature_tags', '房屋特征标签', 'multi_enum',
 '["带浴缸户型"]'::jsonb, NULL, NULL, NULL),

-- ==================== 组织与权限维度（不参与规则配置，供生效范围选择） ====================
('org',       'region',           '大区',       'string', NULL, NULL, NULL, 'region_name'),
('org',       'city',             '城市分公司', 'string', NULL, NULL, NULL, 'city_group_name'),
('org',       'branch',           '营业部',     'string', NULL, NULL, NULL, 'business_name'),
('org',       'station',          '服务站',     'string', NULL, NULL, NULL, 'fwz_org'),
('org',       'station_code',     '服务站编码', 'string', NULL, NULL, NULL, 'fwz_org_code'),
('org',       'community_id',     '项目编码（责任盘）', 'string', NULL, NULL, NULL, 'asset_code'),
('org',       'community_name',   '项目名称（责任盘）', 'string', NULL, NULL, NULL, 'asset_name')
ON CONFLICT (tag_key) DO UPDATE
SET tag_group    = EXCLUDED.tag_group,
    tag_name     = EXCLUDED.tag_name,
    value_type   = EXCLUDED.value_type,
    enum_values  = EXCLUDED.enum_values,
    min_value    = EXCLUDED.min_value,
    max_value    = EXCLUDED.max_value,
    source_column= EXCLUDED.source_column;

-- 历史字典中虽为枚举、但当前产品规则暂不使用的字段保持关闭，避免页面一下显示太多选项。
UPDATE tag_dictionary
SET rule_enabled = false
WHERE tag_key IN ('electric_tags', 'appliance_tags', 'price_sensitivity', 'residence_status', 'house_feature_tags');

-- 当前确认开放的四类核心标签启用规则选择。
UPDATE tag_dictionary
SET rule_enabled = true
WHERE tag_key IN ('water_tags', 'env_tags', 'family_structure', 'decorate_status');

-- 之后新建的标签类别默认即可用于产品规则；不需要修改前端类别清单。
ALTER TABLE tag_dictionary ALTER COLUMN rule_enabled SET DEFAULT true;

-- =================================================================================
-- 行级标签值：tag_value 是产品标签选择器的唯一值来源。
-- 新增常用标签值时，按已有 tag_key 新增一行即可；前端会通过 /api/tags 自动读取。
-- 示例：
-- INSERT INTO tag_value (tag_key, tag_value, sort_order)
-- VALUES ('water_tags', '新增水路标签', 100)
-- ON CONFLICT (tag_key, tag_value) DO UPDATE SET status = 'enabled';
-- 历史 enum_values 只用于初始化；此后新增的标签应维护 tag_value，不必改前端代码。
-- =================================================================================
INSERT INTO tag_value (tag_key, tag_value, sort_order, status)
SELECT
  td.tag_key,
  btrim(v.tag_value),
  (v.ordinality * 10)::integer,
  'enabled'
FROM tag_dictionary td
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(td.enum_values, '[]'::jsonb))
  WITH ORDINALITY AS v(tag_value, ordinality)
WHERE td.tag_key IN ('water_tags', 'env_tags', 'family_structure', 'decorate_status')
  AND btrim(v.tag_value) <> ''
ON CONFLICT (tag_key, tag_value) DO UPDATE
SET sort_order = EXCLUDED.sort_order,
    status = 'enabled';

-- 运维查询：标签字典概览（按标签组核对枚举与溯源列）
-- SELECT tag_group, tag_key, tag_name, value_type, source_column,
--        jsonb_array_length(COALESCE(enum_values, '[]'::jsonb)) AS enum_cnt
-- FROM tag_dictionary ORDER BY tag_group, tag_key;
