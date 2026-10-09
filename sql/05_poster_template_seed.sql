-- =================================================================================
-- 05_poster_template_seed.sql
-- 海报模板初始化种子（PostgreSQL 16）
-- 方案：模板套版 + 变量填充 + Sharp 合成（ADR-006），不用生成式出图。
-- 模板结构由三张真实营销海报反解（资料/*.jpg），详细规格见 docs/POSTER-TEMPLATES.md。
-- 所有三张海报版式一致（竖版 750x1600），槽位相同、变量不同：
--   顶部痛点蓝条 / 主标题（红色强调词）/ 品牌工程师 / 现状→同空间对比卡 /
--   材料品牌 / 三枚卖点 / 万科物业自营信任条 / 左下小程序码 CTA / 社会证明
-- 背景图与小程序码需运营上传至 OSS 后回填 background_oss_key 与 qrcode_oss_key。
-- 幂等：按模板名冲突更新。
-- =================================================================================

-- 业务唯一约束：模板名唯一（架构 §6（12）原索引为 (package_id,status)，幂等种子需要）
CREATE UNIQUE INDEX IF NOT EXISTS uq_poster_template_name ON poster_template (name);

INSERT INTO poster_template (name, package_id, width, height, background_oss_key, svg_spec, status)
SELECT
  v.name, pp.id, 750, 1600, v.background_oss_key, v.svg_spec::jsonb, 'published'
FROM (
  VALUES
  (
    '渗漏检测标准海报',
    'PKG-SEEP',
    'poster/bg/seep_default.png',
    '{
      "canvas": {"width": 750, "height": 1600},
      "slots": {
        "brand_logo": {"asset": "poster/assets/brand_yanxuanjia.png", "x": 36, "y": 40},
        "pain_strip_text": {"x": 60, "y": 130, "maxWidth": 630, "fontSize": 34, "color": "#FFFFFF"},
        "headline_prefix": "你家防水，可能",
        "headline_highlight": "早漏了一年",
        "headline_suffix": "",
        "compare_left_title": "你看到的",
        "compare_left_items": ["墙根潮湿", "发黑发霉"],
        "compare_right_title": "实际原因",
        "compare_right_text": "防水层已经失效",
        "material_brand": "东方雨虹",
        "material_product": "200 柔韧型防水涂料",
        "features": [
          {"icon": "shield-check", "text": "深层渗透修复"},
          {"icon": "clock", "text": "快速施工省时"},
          {"icon": "badge-check", "text": "防水质保10年"}
        ],
        "trust_text": "万科物业自营，不达标砸了重来",
        "cta_title": "扫码预约免费渗漏检测",
        "cta_sub": "",
        "social_proof": "已有100户邻居完成检测",
        "qrcode_oss_key": "poster/assets/qrcode_default.png",
        "footer_tip": "别等渗水发霉再补救"
      },
      "rules": {
        "pain_strip_text": "由规则标签动态生成，备选词库：墙根发霉 / 门口发黑 / 地漏反味",
        "social_proof": "按项目(community_id)取真实检测完成户数，不足20户时降级为通用话术，禁止编造数字"
      }
    }'
  ),
  (
    '浴改淋标准海报',
    'PKG-TUB2SHOWER',
    'poster/bg/tub2shower_default.png',
    '{
      "canvas": {"width": 750, "height": 1600},
      "slots": {
        "brand_logo": {"asset": "poster/assets/brand_yanxuanjia.png", "x": 36, "y": 40},
        "pain_strip_text": {"x": 60, "y": 130, "maxWidth": 630, "fontSize": 34, "color": "#FFFFFF"},
        "headline_prefix": "浴缸秒变淋浴",
        "headline_highlight": "立省1㎡",
        "headline_suffix": "",
        "compare_left_title": "现状",
        "compare_left_items": ["浴缸常年闲置"],
        "compare_right_title": "同一空间",
        "compare_right_text": "淋浴干湿分离",
        "material_brand": "",
        "material_product": "壁龛浴室柜补收纳，空间利用翻倍",
        "features": [
          {"icon": "shield", "text": "万科物业自营"},
          {"icon": "calendar-clock", "text": "超期按天赔付"},
          {"icon": "package-x", "text": "不搬家施工"}
        ],
        "trust_text": "小改造，大改变",
        "cta_title": "点击扫码看同户型方案",
        "cta_sub": "",
        "social_proof": "20户邻居已改好，你还在等什么？",
        "qrcode_oss_key": "poster/assets/qrcode_default.png",
        "footer_tip": ""
      },
      "rules": {
        "pain_strip_text": "由家庭结构动态生成，备选词库：浴缸空着 / 收纳不足 / 早高峰抢不停",
        "social_proof": "按项目取真实改造完成户数，不足20户时降级为通用话术，禁止编造数字"
      }
    }'
  ),
  (
    '墙面刷新标准海报',
    'PKG-REFRESH',
    'poster/bg/refresh_default.png',
    '{
      "canvas": {"width": 750, "height": 1600},
      "slots": {
        "brand_logo": {"asset": "poster/assets/brand_yanxuanjia.png", "x": 36, "y": 40},
        "pain_strip_text": {"x": 60, "y": 130, "maxWidth": 630, "fontSize": 34, "color": "#FFFFFF"},
        "headline_prefix": "旧房墙面刷新 ",
        "headline_highlight": "焕新一整家",
        "headline_suffix": "",
        "compare_left_title": "现状：",
        "compare_left_items": ["霉斑墙面", "开裂掉皮", "空鼓脱落"],
        "compare_right_title": "同空间：",
        "compare_right_text": "整洁墙面，环保健康、美观耐用",
        "material_brand": "PPG大师漆",
        "material_product": "环保等级、遮盖力远超国标",
        "features": [
          {"icon": "shield-check", "text": "万科物业自营有保障"},
          {"icon": "hard-hat", "text": "标准化施工自有工人"},
          {"icon": "leaf", "text": "精选环保漆安心入住"}
        ],
        "trust_text": "精细保护 · 腻子精修 · 净味涂料，根源阻断霉斑",
        "cta_title": "扫码送3㎡免费刷新",
        "cta_sub": "仅限5席，先到先得",
        "social_proof": "墙面霉斑开裂不用忍，免费墙面勘测+配色方案",
        "qrcode_oss_key": "poster/assets/qrcode_default.png",
        "footer_tip": ""
      },
      "rules": {
        "pain_strip_text": "由环境标签动态生成，备选词库：旧墙掉皮 / 发霉发黑 / 污渍难擦",
        "cta_sub": "名额类话术必须与真实活动配置一致，活动结束后由运营停用模板，禁止展示过期承诺"
      }
    }'
  )
) AS v(name, pkg_code, background_oss_key, svg_spec)
JOIN product_package pp ON pp.code = v.pkg_code
ON CONFLICT (name) DO UPDATE
SET package_id        = EXCLUDED.package_id,
    width            = EXCLUDED.width,
    height           = EXCLUDED.height,
    background_oss_key = EXCLUDED.background_oss_key,
    svg_spec         = EXCLUDED.svg_spec,
    status           = EXCLUDED.status;

-- 运维查询：模板与产品包绑定核对
-- SELECT pt.name, pp.code AS package_code, pt.width, pt.height, pt.status
-- FROM poster_template pt JOIN product_package pp ON pp.id = pt.package_id;
