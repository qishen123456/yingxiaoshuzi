-- =============================================================================
-- 06_business_tables_ddl.sql
-- 业务数据基础表：房屋标签快照、标签配置字典、产品标签映射
-- 数据库：PostgreSQL 16（应用库 / RDS）
--
-- 说明：
-- 1. 房屋标签由数据侧从上游宽表 T+1 同步，house_label_snapshot 只保留最新快照。
-- 2. 标签元数据由业务人工维护：tag_dictionary 管类别，tag_value 管可选值。
-- 3. 产品命中逻辑由 mapping_rule.condition_json 配置，开发统一读取，不写死在页面。
-- 4. 线索明细是既有数据资产。本文件不重复创建上游线索表；应用库如使用 lead_record，
--    由现有 Prisma migration / 线索同步任务维护。
-- 5. 本脚本为幂等参考 DDL。生产执行前先核对现有 migration 和目标库，勿绕过发布流程。
-- =============================================================================

BEGIN;

-- A. 产品包：mapping_rule 的依赖表
CREATE TABLE IF NOT EXISTS product_package (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'enabled',
  product_items_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- B. 互斥组：同一互斥组内优先级最高的规则优先
CREATE TABLE IF NOT EXISTS mutex_group (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  mode VARCHAR(16) NOT NULL DEFAULT 'single',
  status VARCHAR(16) NOT NULL DEFAULT 'enabled'
);

-- C. 房屋标签快照：一房一行，标签内容放入 JSONB
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

COMMENT ON TABLE house_label_snapshot IS '房屋标签最新快照；数据侧 T+1 同步，应用侧只读消费';
COMMENT ON COLUMN house_label_snapshot.house_id IS 'Pride 房屋编码；系统内首选房屋关联键';
COMMENT ON COLUMN house_label_snapshot.zhantu_house_id IS '战图房屋编码；Pride 编码缺失时用于备用关联';
COMMENT ON COLUMN house_label_snapshot.labels IS '动态标签 JSONB；多值标签保存为字符串数组，数值标签保存为数值';
COMMENT ON COLUMN house_label_snapshot.stat_date IS '本次同步对应的业务日期，不代表线索实时更新时间';

CREATE INDEX IF NOT EXISTS idx_hls_city_community
  ON house_label_snapshot (city, community_id);
CREATE INDEX IF NOT EXISTS idx_hls_org_scope
  ON house_label_snapshot (region, city, branch, station);
CREATE INDEX IF NOT EXISTS idx_hls_labels_gin
  ON house_label_snapshot USING GIN (labels jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_hls_label_date
  ON house_label_snapshot (stat_date);

-- D. 标签类别配置表：人工维护标签名称、类型及上游字段映射
CREATE TABLE IF NOT EXISTS tag_dictionary (
  id BIGSERIAL PRIMARY KEY,
  tag_group VARCHAR(64) NOT NULL,
  tag_key VARCHAR(64) NOT NULL UNIQUE,
  tag_name VARCHAR(128) NOT NULL,
  value_type VARCHAR(16) NOT NULL,
  enum_values JSONB,
  min_value NUMERIC,
  max_value NUMERIC,
  source_column VARCHAR(64),
  rule_enabled BOOLEAN NOT NULL DEFAULT true
);

COMMENT ON TABLE tag_dictionary IS '标签类别配置字典；人工维护，不随房屋快照每日覆写';
COMMENT ON COLUMN tag_dictionary.source_column IS '对应上游真实字段；新增物理字段时仍需开发数据接入映射';
COMMENT ON COLUMN tag_dictionary.rule_enabled IS '是否允许产品规则配置页选择该标签类别';

CREATE INDEX IF NOT EXISTS idx_tag_dictionary_group
  ON tag_dictionary (tag_group);
CREATE INDEX IF NOT EXISTS idx_tag_dictionary_enabled_type
  ON tag_dictionary (rule_enabled, value_type);

-- E. 标签可选值表：允许单个类别下人工增删启用值
CREATE TABLE IF NOT EXISTS tag_value (
  id BIGSERIAL PRIMARY KEY,
  tag_key VARCHAR(64) NOT NULL REFERENCES tag_dictionary(tag_key) ON DELETE CASCADE,
  tag_value VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'enabled',
  sort_order INTEGER NOT NULL DEFAULT 1000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_tag_value_key_value UNIQUE (tag_key, tag_value)
);

CREATE INDEX IF NOT EXISTS idx_tag_value_selector
  ON tag_value (tag_key, status, sort_order);

COMMENT ON TABLE tag_value IS '标签类别对应的实际可选值；新增值只维护此表，无需改前端固定枚举';

-- F. 产品标签映射规则：用 JSONB 保存规则条件，运行时由规则引擎统一解释
CREATE TABLE IF NOT EXISTS mapping_rule (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  package_id BIGINT NOT NULL REFERENCES product_package(id),
  priority INTEGER NOT NULL DEFAULT 100,
  mutex_group_id BIGINT REFERENCES mutex_group(id),
  condition_logic VARCHAR(8) NOT NULL DEFAULT 'AND',
  condition_json JSONB NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'disabled',
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE mapping_rule IS '产品与房屋标签映射规则；priority 数值越小越优先；空条件不得命中';
COMMENT ON COLUMN mapping_rule.condition_json IS '结构示例：{"logic":"AND","conditions":[{"tag":"water_tags","op":"contains_any","value":["卫生间漏水"]}]}';

CREATE INDEX IF NOT EXISTS idx_mapping_rule_status_priority
  ON mapping_rule (status, priority, id);
CREATE INDEX IF NOT EXISTS idx_mapping_rule_package
  ON mapping_rule (package_id);
CREATE INDEX IF NOT EXISTS idx_mapping_rule_mutex
  ON mapping_rule (mutex_group_id);

COMMIT;

-- 首次验收建议：
-- SELECT COUNT(*) AS house_count, MAX(stat_date) AS latest_house_stat_date
-- FROM house_label_snapshot;
-- SELECT tag_key, tag_name, value_type, rule_enabled FROM tag_dictionary ORDER BY tag_group, tag_key;
-- SELECT tag_key, tag_value, status FROM tag_value ORDER BY tag_key, sort_order;
-- SELECT name, package_id, priority, status, condition_json FROM mapping_rule ORDER BY priority, id;
