-- 08. 研选系统人群包、推送内容快照与海报预览
-- 在测试库核验后再部署；这些表记录营销批次，不代表真实渠道发送。
ALTER TABLE poster_template ADD COLUMN IF NOT EXISTS preview_data TEXT;
CREATE TABLE IF NOT EXISTS audience_package (
 id BIGSERIAL PRIMARY KEY, name VARCHAR(160) NOT NULL, criteria TEXT,
 created_by VARCHAR(128) NOT NULL DEFAULT '未接入登录', status VARCHAR(16) NOT NULL DEFAULT 'saved',
 house_count INTEGER NOT NULL DEFAULT 0, unique_phone_count INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audience_package_created_at ON audience_package(created_at DESC);
CREATE TABLE IF NOT EXISTS audience_package_house (
 id BIGSERIAL PRIMARY KEY, audience_package_id BIGINT NOT NULL REFERENCES audience_package(id) ON DELETE CASCADE,
 house_id VARCHAR(64) NOT NULL REFERENCES house_label_snapshot(house_id) ON DELETE CASCADE,
 house_snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT uq_audience_package_house UNIQUE(audience_package_id,house_id)
);
CREATE INDEX IF NOT EXISTS idx_audience_package_house_house_id ON audience_package_house(house_id);
CREATE TABLE IF NOT EXISTS marketing_push_batch (
 id BIGSERIAL PRIMARY KEY, audience_package_id BIGINT REFERENCES audience_package(id) ON DELETE SET NULL,
 package_name VARCHAR(160) NOT NULL, sender VARCHAR(128) NOT NULL DEFAULT '未接入登录',
 content_snapshot TEXT NOT NULL, poster_name VARCHAR(255), poster_data TEXT,
 channels JSONB NOT NULL DEFAULT '[]'::jsonb, criteria TEXT, house_count INTEGER NOT NULL DEFAULT 0,
 unique_phone_count INTEGER NOT NULL DEFAULT 0, status VARCHAR(24) NOT NULL DEFAULT 'recorded_demo',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_push_batch_created_at ON marketing_push_batch(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_push_batch_package_id ON marketing_push_batch(audience_package_id);
CREATE TABLE IF NOT EXISTS marketing_push_batch_house (
 id BIGSERIAL PRIMARY KEY, marketing_push_batch_id BIGINT NOT NULL REFERENCES marketing_push_batch(id) ON DELETE CASCADE,
 house_id VARCHAR(64) NOT NULL REFERENCES house_label_snapshot(house_id) ON DELETE CASCADE,
 house_snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT uq_marketing_batch_house UNIQUE(marketing_push_batch_id,house_id)
);
CREATE INDEX IF NOT EXISTS idx_marketing_batch_house_house_id ON marketing_push_batch_house(house_id);
