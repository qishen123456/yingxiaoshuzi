-- =================================================================================
--  全量线索宽表 (ads_yx_clue_full_detail) 组装脚本
-- =================================================================================
-- 💡 【ADB PostgreSQL 兼容表结构变更 DDL】(加字段 + 写注释分开执行)
-- ---------------- ADS 层: 先加字段 ----------------
-- ALTER TABLE yanxuan.ads_yx_clue_full_detail ADD COLUMN wechat_min_at timestamp;
-- ALTER TABLE yanxuan.ads_yx_clue_full_detail ADD COLUMN group_min_at timestamp;
-- ALTER TABLE yanxuan.ads_yx_clue_full_detail ADD COLUMN onekey_group_time timestamp;
-- ALTER TABLE yanxuan.ads_yx_clue_full_detail ADD COLUMN latest_transfer_time timestamp;
-- ALTER TABLE yanxuan.ads_yx_clue_full_detail ADD COLUMN latest_transfer_type varchar;
-- ALTER TABLE yanxuan.ads_yx_clue_full_detail ADD COLUMN is_new_transfer varchar;
-- ---------------- ADS 层: 再写注释 ----------------
-- COMMENT ON COLUMN yanxuan.ads_yx_clue_full_detail.wechat_min_at IS '首次加微时间';
-- COMMENT ON COLUMN yanxuan.ads_yx_clue_full_detail.group_min_at IS '首次建群时间';
-- COMMENT ON COLUMN yanxuan.ads_yx_clue_full_detail.onekey_group_time IS '一键拉群成功时间';
-- COMMENT ON COLUMN yanxuan.ads_yx_clue_full_detail.latest_transfer_time IS '最近过户时间';
-- COMMENT ON COLUMN yanxuan.ads_yx_clue_full_detail.latest_transfer_type IS '最近过户类型';
-- COMMENT ON COLUMN yanxuan.ads_yx_clue_full_detail.is_new_transfer IS '是否新过户(30天内)';
-- =================================================================================
-- 清空ADS表，以便重新插入最新数据
TRUNCATE TABLE yanxuan.ads_yx_clue_full_detail;


-- 从DWS层关联数据并插入ADS层 (精简无重复版)
INSERT INTO yanxuan.ads_yx_clue_full_detail
SELECT
    -- I. 从 dws_yx_clue_main_info 表选择所有字段
    main.clue_id,
    main.weijia_clue_id,
    main.created_time,
    main.customer_name,
    main.customer_mobile,
    main.customer_mobile_masked,
    main.customer_level,
    main.creator_name,
    main.creator_mobile,
    main.referrer_name,
    main.referrer_sap,
    main.referrer_mobile,
    main.referrer_position,
    main.follower_name,
    main.follower_sap,
    main.follower_mobile,
    main.follower_position,
    main.intention_type,
    main.intention_first_type,
    main.intention_second_type,
    main.origin_intention_first_type,
    main.intention_type_l1,
    main.intention_type_l2,
    main.intention_type_l3,
    main.last_type_name,
    main.channel_category_l1,
    main.channel_category_l2,
    main.entry_channel,
    main.source_channel,
    main.entry_point,
    main.region,
    main.city_name,
    main.city_company,
    main.business_unit,
    main.butterfly_city,
    main.service_station,
    main.organization_name,
    main.organization_code,
    main.project_name,
    main.project_code,
    main.grid_name,
    main.grid_code,
    main.house_name,
    main.house_code,
    main.business_status,
    main.is_repair,
    main.is_responsibility,
    main.is_suspended,
    main.suspend_reason,
    main.is_test,
    main.remind_update_count,
    main.budget_amount,
    main.decoration_time,

    -- II. 从 dws_yx_clue_action_record 表选择其独有的字段
    action.creator_sap,
    action.creator_position,
    action.referrer_id,
    action.referrer_region,
    action.referrer_city_company,
    action.referrer_business_unit,
    action.referrer_butterfly_city,
    action.referrer_service_station,
    action.follower_id,
    action.follower_region,
    action.follower_city_company,
    action.follower_business_unit,
    action.follower_butterfly_city,
    action.follower_service_station,
    action.first_assigner_id,
    action.first_assigner_name,
    action.first_assigner_mobile,
    action.first_assigner_sap,
    action.first_assigner_position,
    action.close_applicant_name,
    action.final_approve_auditor_name,
    action.final_reject_auditor_name,
    action.terminate_desc,
    action.terminate_reason,
    action.follow_up_time,
    action.confirm_valid_time,
    action.confirm_invalid_time,
    action.first_assign_time,
    action.first_accept_time,
    action.first_self_follow_time,
    action.first_follow_time,
    action.first_contact_time,
    action.first_wechat_contact_time,
    action.latest_follow_time,
    action.latest_contact_time,
    action.appoint_measure_house_time,
    action.measure_house_time,
    action.drawing_upload_time,
    action.first_plan_communicate_time,
    action.quote_time,
    action.site_visit_time,
    action.showroom_visit_time,
    action.introduction_time,
    action.deposit_time,
    action.sign_time,
    action.latest_apply_close_time,
    action.latest_approve_time,
    action.latest_reject_time,
    action.latest_deal_time,
    action.latest_not_deal_time,
    action.end_time,
    action.auto_close_time,
    main.servicestation_code,
    action.latest_order_time,
    action.latest_order_no,
    action.first_central_time,
    action.close_type_l1,                                                          -- 申请闭单-一级类型
    action.close_type_l2,                                                          -- 申请闭单-二级类型
    action.close_apply_reason,
    COALESCE(yj.order_cnt,0) order_cnt,
    COALESCE(yj.performance_final,0) performance_final,
    mp.quotation_amount,
    h.zhantu_code as zhantu_housecode, 
    h.zhantu_projectcode,
    h.zhantu_projectname,
    zd.managementcentercode,
    zd.managementcentername,
    main.intention_description,        -- 意向描述：可填写关于客户的当前房屋用途、客户意向、客户预算、入住时间、喜好风格等信息（总字符不超过200个）
    main.is_house_detection_completed,    -- 是否完成入户计划
    
    -- =================== 档案袋资料字段 (16个) ===================
    action.original_layout_url,                                                         -- 户型原始图链接
    action.original_layout_upload_time,                                                 -- 户型原始图上传时间
    action.site_photo_url,                                                              -- 现场空间照片链接
    action.site_photo_upload_time,                                                      -- 现场空间照片上传时间
    action.cad_drawing_url,                                                             -- 量房CAD图纸链接
    action.cad_drawing_upload_time,                                                     -- 量房CAD图纸上传时间
    action.measure_record_url,                                                          -- 量房记录表链接
    action.measure_record_upload_time,                                                  -- 量房记录表上传时间
    action.final_layout_url,                                                            -- 终版平面布置图链接
    action.final_layout_upload_time,                                                    -- 终版平面布置图上传时间
    action.cabinet_drawing_url,                                                         -- 定制柜图纸链接
    action.cabinet_drawing_upload_time,                                                 -- 定制柜图纸上传时间
    action.rendering_image_url,                                                         -- 效果图图片链接
    action.rendering_image_upload_time,                                                 -- 效果图图片上传时间
    action.rendering_vr_url,                                                            -- 效果图VR链接地址
    action.rendering_vr_upload_time,                                                     -- 效果图VR链接上传时间
    -- =================== 独立微信建联明细时间 (3个) ===================
    action.wechat_min_at,                                                              -- 首次"加微"时间
    action.group_min_at,                                                               -- 首次"建群"时间
    action.onekey_group_time,                                                          -- 一键拉群成功时间
    -- =================== 房屋过户信息 (3个) ===================
    action.latest_transfer_time,                                                       -- 最近过户时间
    action.latest_transfer_type,                                                       -- 最近过户类型
    action.is_new_transfer                                                              -- 是否新过户(30天内)
FROM
    yanxuan.dws_yx_clue_main_info AS main
LEFT JOIN
    yanxuan.dws_yx_clue_action_record AS action
    ON main.clue_id = action.clue_id
left join (select clue_id
                ,count(distinct order_code) as order_cnt --订单量
                ,sum(COALESCE(performance_final,0)) as performance_final --市场业绩
            from yanxuan.dws_yx_all_performance_detail --业绩表
            where performance_effect_time is not null and clue_id is not null
          GROUP BY clue_id
            ) yj
    ON main.clue_id::text = yj.clue_id
left join
(
    select clue_id, sum(total_amount) as quotation_amount from meiju.ods_blacksam_t_quotation where status = 2 group by clue_id
) mp
on main.clue_id::text = mp.clue_id
left join other.cdw_pride_pride_house h 
on main.house_code=h.code 
left join 
(select project_code, 
    min(managementcentercode) managementcentercode, --战图阵地编码
    min(managementcentername) managementcentername --战图阵地名称
    from other.cdw_pride_pride_house where managementcentercode is not null 
     GROUP BY project_code) zd
on main.project_code=zd.project_code
;

--20251222 新增线索【成交市场业绩】、【成交业绩单量】字段
-- ALTER TABLE yanxuan.ads_yx_clue_full_detail ADD COLUMN order_cnt int;
-- ALTER TABLE yanxuan.ads_yx_clue_full_detail ADD COLUMN performance_final NUMERIC ;
--20251230 增加房屋字典对应的战图房屋编码、项目、阵地
-- ALTER TABLE yanxuan.ads_yx_clue_full_detail ADD COLUMN zhantu_housecode text; --战图房屋编码
-- ALTER TABLE yanxuan.ads_yx_clue_full_detail ADD COLUMN zhantu_projectcode text; --战图项目编码
-- ALTER TABLE yanxuan.ads_yx_clue_full_detail ADD COLUMN zhantu_projectname text; --战图项目名称
-- ALTER TABLE yanxuan.ads_yx_clue_full_detail ADD COLUMN managementcentercode text; --战图阵地编码
-- ALTER TABLE yanxuan.ads_yx_clue_full_detail ADD COLUMN managementcentername text; --战图阵地名称


-- ---------------------------------------------------------------------------------
-- 💡 【Quick BI 数据集查询 SQL】研选线索全景明细表 (含独立微信建联时间 3 字段)
-- ---------------------------------------------------------------------------------
/*
SELECT
    m1.clue_id AS "线索ID",
    weijia_clue_id AS "线上为家平台线索ID",
    created_time AS "创建时间",
    customer_name AS "客户姓名",
    customer_mobile AS "客户电话",
    customer_mobile_masked AS "客户电话（脱敏）",
    customer_level AS "客户意向等级",
    creator_name AS "提报人姓名",
    creator_mobile AS "提报人电话",
    referrer_name AS "转介人姓名",
    referrer_sap AS "转介人SAP",
    referrer_mobile AS "转介人电话",
    referrer_position AS "转介人岗位",
    follower_name AS "跟进人姓名",
    follower_sap AS "跟进人SAP号",
    follower_mobile AS "跟进人电话",
    follower_position AS "跟进人岗位",
    intention_type AS "意向类型",
    intention_first_type AS "一级意向类型",
    intention_second_type AS "二级意向类型",
    origin_intention_first_type AS "最初的一级意向类型",
    intention_type_l1 AS "一级意向(JSON)",
    intention_type_l2 AS "二级意向(JSON)",
    intention_type_l3 AS "三级意向(JSON)",
    last_type_name AS "末级意向类型",
    intention_description AS "意向描述",
    channel_category_l1 AS "一级渠道分类",
    channel_category_l2 AS "二级渠道分类",
    entry_channel AS "进线入口",
    source_channel AS "进线渠道",
    entry_point AS "进线点位",
    region AS "区域",
    city_name AS "城市",
    city_company AS "城市分公司",
    business_unit AS "事业部",
    butterfly_city AS "研选蝶城",
    service_station AS "服务站",
    organization_name AS "末级组织名称",
    organization_code AS "末级组织编码",
    project_name AS "项目名称",
    project_code AS "项目编码",
    managementcentercode as "阵地编码",
    managementcentername as "阵地名称",
    grid_name AS "网格名称",
    grid_code AS "网格编码",
    house_name AS "房屋名称",
    house_code AS "房屋编码",
    business_status AS "商机状态",
    is_repair AS "是否维修",
    is_responsibility AS "是否责任盘",
    is_suspended AS "是否挂起",
    suspend_reason AS "挂起理由",
    is_test AS "是否测试数据",
    remind_update_count AS "提醒更新跟进记录次数",
    budget_amount AS "预计成交金额",
    decoration_time AS "预计签约时间",
    creator_sap AS "提报人SAP号",
    creator_position AS "提报人岗位",
    referrer_id AS "转介人ID",
    referrer_region AS "转介人_一级组织",
    referrer_city_company AS "转介人_二级组织",
    referrer_business_unit AS "转介人_三级组织",
    referrer_butterfly_city AS "转介人_四级组织",
    referrer_service_station AS "转介人_五级组织",
    follower_id AS "跟进人ID",
    follower_region AS "跟进人区域",
    follower_city_company AS "跟进人城市分公司",
    follower_business_unit AS "跟进人事业部",
    follower_butterfly_city AS "跟进人蝶城",
    follower_service_station AS "跟进人服务站",
    first_assigner_id AS "首次指派人ID",
    first_assigner_name AS "首次指派人姓名",
    first_assigner_mobile AS "首次指派人手机号",
    first_assigner_sap AS "首次指派人SAP号",
    first_assigner_position AS "首次指派人岗位",
    close_applicant_name AS "最新闭单申请人姓名",
    final_approve_auditor_name AS "最新闭单审核通过人姓名",
    final_reject_auditor_name AS "最新闭单审核不通过人姓名",
    terminate_desc AS "闭单说明",
    terminate_reason AS "结束理由",
    follow_up_time AS "挂起状态下的预计下次跟进时间",
    confirm_valid_time AS "确认有效时间",
    confirm_invalid_time AS "确认无效时间",
    first_assign_time AS "站长分配时间",
    first_accept_time AS "首次接单时间",
    first_self_follow_time AS "PA自我跟进时间",
    first_follow_time AS "首次填写跟进记录时间",
    first_contact_time AS "首次电话联系客户时间",
    first_wechat_contact_time AS "首次建联时间",
    latest_follow_time AS "最近一次跟进时间",
    latest_contact_time AS "最近电话联系客户时间",
    appoint_measure_house_time AS "首次预约量房时间",
    measure_house_time AS "首次量房时间",
    drawing_upload_time AS "首次上传量房图纸时间",
    first_plan_communicate_time AS "首次初版方案沟通时间",
    quote_time AS "首次报价时间",
    site_visit_time AS "首次带看工地时间",
    showroom_visit_time AS "首次带看样板间时间",
    introduction_time AS "首次介绍时间",
    deposit_time AS "首次交定金时间",
    sign_time AS "首次签约时间",
    latest_apply_close_time AS "最新申请结束跟进时间",
    latest_approve_time AS "最新结束跟进审核通过时间",
    latest_reject_time AS "最新结束跟进审核不通过时间",
    latest_deal_time AS "转介结束成交时间",
    latest_not_deal_time AS "转介结束未成交时间",
    end_time AS "线索闭单时间",
    auto_close_time AS "超时自动闭单时间",
    latest_order_time AS "最新绑定订单时间",
    latest_order_no AS "最新绑定订单编号",
    first_central_time AS "中央客服指派时间",
    servicestation_code AS "服务站编码",
    m2.total_amount as 报价单金额,
    m1.close_type_l1  AS "一级闭单类型",
    m1.close_type_l2 AS "二级闭单类型",
    m1.close_apply_reason AS "详细闭单理由",
    m1.order_cnt as 成交业绩单量,
    m1.performance_final as 成交市场业绩,
    m1.is_house_detection_completed AS "是否完成入户计划",
    m1.original_layout_url AS "户型原始图链接",
    m1.original_layout_upload_time AS "户型原始图上传时间",
    m1.site_photo_url AS "现场空间照片链接",
    m1.site_photo_upload_time AS "现场空间照片上传时间",
    m1.cad_drawing_url AS "量房CAD图纸链接",
    m1.cad_drawing_upload_time AS "量房CAD图纸上传时间",
    m1.measure_record_url AS "量房记录表链接",
    m1.measure_record_upload_time AS "量房记录表上传时间",
    m1.final_layout_url AS "终版平面布置图链接",
    m1.final_layout_upload_time AS "终版平面布置图上传时间",
    m1.cabinet_drawing_url AS "定制柜图纸链接",
    m1.cabinet_drawing_upload_time AS "定制柜图纸上传时间",
    m1.rendering_image_url AS "效果图图片链接",
    m1.rendering_image_upload_time AS "效果图图片上传时间",
    m1.rendering_vr_url AS "效果图VR链接地址",
    m1.rendering_vr_upload_time AS "效果图VR链接上传时间",
    -- =================== 新增独立微信建联明细时间 (3个) ===================
    m1.wechat_min_at AS "首次加微时间",
    m1.group_min_at AS "首次建群时间",
    m1.onekey_group_time AS "一键拉群成功时间",
    -- =================== 新增房屋过户信息 (3个) ===================
    m1.latest_transfer_time AS "最近过户时间",
    m1.latest_transfer_type AS "最近过户类型",
    m1.is_new_transfer AS "是否新过户(30天内)"
FROM
    yanxuan.ads_yx_clue_full_detail m1
LEFT JOIN
(
    SELECT clue_id, SUM(total_amount) AS total_amount FROM meiju.ods_blacksam_t_quotation WHERE status = 2 GROUP BY clue_id
) m2
ON m1.clue_id::text = m2.clue_id;
*/