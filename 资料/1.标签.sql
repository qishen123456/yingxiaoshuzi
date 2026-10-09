--@exclude_input=5557697329220030331
--@exclude_input=vs5space.o2d_dwd_uno_meta_family_structure_label
--MaxCompute SQL
--********************************************************************--
--author: 唐爱玲
--create time: 2026-06-10 11:21:00
--********************************************************************--
-- drop table weijia.dwd_yanxuan_responsible_project_hosue_label
-- create table dwd_yanxuan_responsible_project_hosue_label
-- (region_name	string comment '大区',
-- city_group_name	string comment '城市分公司',
-- business_name	string comment '营业部',
-- fwz_org_code	string comment '服务站编码',
-- fwz_org	string comment '服务站',
-- code	string comment '房屋编码',
-- name	string comment '房屋名称',
-- house_code	string comment '战图房屋编码',
-- asset_code	string comment '项目编码',
-- asset_name	string comment '项目名称',
-- shuilu_label	string comment '维修_水路标签',
-- dianlu_tag	string comment '维修_电路标签',
-- jiadian_tag	string comment '维修_家电标签',
-- envir_tag	string comment '维修_环境标签',
-- price_sensitivity_label string comment '价格敏感标签',
-- kitchen_repair	BIGINT COMMENT '厨房维修次数',
-- balcony_repair	BIGINT COMMENT '阳台维修次数',
-- bathroom_repair BIGINT COMMENT '卫生间维修次数'
-- ) comment '研选责任盘房屋标签'
-- alter table dwd_yanxuan_responsible_project_hosue_label 
-- add columns 
-- (property_area decimal(38,18) comment '建筑面积',
-- layout string comment '户型')

with rp as--维修标签
(SELECT 
house_code,
count(distinct clue_id) ttl_clue_num,
count(distinct case when create_time>=datetrunc(dateadd(getdate(),-365,'dd'),'dd') then clue_id end) cur_yyyy_clue_num,
min(create_time) first_time,
max(create_time) last_time,
wm_concat(distinct ',',matter_type) matter_type,
wm_concat(distinct ',' ,shuilu_label) shuilu_label,
wm_concat(distinct ',' ,dianlu_label) dianlu_label,
wm_concat(distinct ',' ,jiadian_label) jiadian_label,
wm_concat(distinct ',' ,envir_label) envir_label,
count(distinct case when clue_remark regexp '厨房' then clue_id end) kitchen_repair,
count(distinct case when clue_remark regexp '阳台' then clue_id end) balcony_repair,
count(distinct case when clue_remark regexp '厕所|卫生间' then clue_id end) bathroom_repair
FROM (
    SELECT *,
        -- 水路问题
        CASE
            WHEN (clue_remark REGEXP '水|潮|湿|漏|堵'
                OR category_name IN ('防水补漏')) AND clue_remark REGEXP '卫生间|厕所'
                THEN '卫生间漏水'
                
            WHEN (clue_remark REGEXP '水|潮|湿|漏|堵'
                OR category_name IN ('防水补漏')) AND clue_remark REGEXP '厨房'
                THEN '厨房漏水'
            WHEN (clue_remark REGEXP '水|潮|湿|漏|堵'
                OR category_name IN ('防水补漏')) AND clue_remark REGEXP '阳台'
                THEN '阳台漏水'
                
            WHEN clue_remark REGEXP '水管老化|铁管锈蚀' THEN '水管老化'
        end shuilu_label,
        case 
            -- 电路问题
            WHEN clue_remark REGEXP '跳闸|跳电'
                THEN '跳闸'
                
            WHEN (clue_remark REGEXP '插座' and clue_remark REGEXP '有问题|坏|故障|烧')
                THEN '插座故障'
                
            WHEN clue_remark REGEXP '电路|线路|电线' AND clue_remark REGEXP '老化'
                THEN '电路老化' end dianlu_label,
         case        
            -- 家电问题
           WHEN matter_type_1='维修' AND clue_remark REGEXP '空调' THEN '空调故障'
                
            WHEN matter_type_1='维修' AND clue_remark REGEXP '热水器'  THEN '热水器故障'
                
            WHEN matter_type_1='维修' AND clue_remark REGEXP '冰箱'  THEN '冰箱故障'
             end jiadian_label,   
             case 
            -- 环境问题
            WHEN clue_remark REGEXP '墙' and clue_remark regexp '霉'
                THEN '墙面发霉'
                
            WHEN clue_remark REGEXP '墙|地' AND clue_remark REGEXP '水|潮|湿|漏'
                THEN '渗水/返潮'
                
            WHEN clue_remark REGEXP '老化|开裂|破损'  AND clue_remark REGEXP '厨房'
                THEN '厨房老化'
                
            WHEN clue_remark REGEXP '老化|开裂'  AND clue_remark REGEXP '卫生间|厕所'
                THEN '卫生间老化'
            WHEN clue_remark REGEXP '老化|开裂'  AND clue_remark REGEXP '阳台'
                THEN '阳台老化'
            WHEN clue_remark REGEXP '裂|空鼓|漏缝'  AND clue_remark REGEXP '瓷砖|地砖|地板'
                THEN '瓷砖开裂空鼓'
            end envir_label
    from
    (select prid_house_code house_code,clue_remark,clue_id,create_time,matter_type_1,matter_type,coalesce(matter_type,matter_type_2) category_name
    FROM vs5space.dwd_home_repair_clue_full_detail
    WHERE prid_house_code IS NOT NULL AND prid_house_code<>''
    and matter_type_1='维修'
    union --房屋入户调查问卷
    select coalesce(t2.housecode,t3.housecode) house_code,t1.home_problem clue_remark,NULL clue_id,CAST(create_time AS DATETIME)  create_time,null matter_type_1,null matter_type,null category_name
from 
(
SELECT house_name,regexp_replace(home_problem,',',';') home_problem,create_time,
concat_ws(',',split(project_name,',')[1],house_name) house_name2
from vs5space.ods_yx_data_collection_exhi_zx
UNION ALL
SELECT house_name,regexp_replace(home_problem,',',';') home_problem,create_time,
concat_ws(',',split(project_name,',')[1],house_name) house_name2
 from vs5space.ods_yx_data_collection_exhi_hn
UNION ALL
SELECT house_name,regexp_replace(home_problem,',',';') home_problem,create_time,
concat_ws(',',split(project_name,',')[1],house_name) house_name2
from vs5space.ods_yx_data_collection_exhi_hb
UNION ALL
SELECT house_name,regexp_replace(home_problem,',',';') home_problem,create_time,
concat_ws(',',split(project_name,',')[1],house_name) house_name2
from vs5space.ods_yx_data_collection_exhi_hd
) t1
left join 
(select housecode,concat_ws(',',project_name,unit_number,house_name_extra) housename,row_number() over(partition by concat(project_name,unit_number,house_name_extra) order by housecode desc) num
from weijia.cdw_weijia_pride_house_proj) t2 on t2.housename=t1.house_name and t2.num=1--避免房屋名称发散
left join 
(select housecode,concat_ws(',',project_name,building_name,unit_number,house_name_extra) housename,row_number() over(partition by concat_ws(',',project_name,building_name,unit_number,house_name_extra) order by housecode desc) num
from weijia.cdw_weijia_pride_house_proj) t3 on t3.housename=t1.house_name2 and t3.num=1--避免房屋名称发散
where t1.Home_problem not in ('其他','')
and t1.house_name is not null
and coalesce(t2.housecode,t3.housecode) is not null
    )
  ) t
group by house_code)

insert OVERWRITE table weijia.dwd_yanxuan_responsible_project_hosue_label
select distinct t3.region_name,t3.city_group_name,t3.business_name,t3.fwz_org_code,t3.fwz_org,t1.code,t1.name,t1.house_code,t3.asset_code,t3.asset_name
,shuilu_label,dianlu_label,jiadian_label,envir_label,price_sensitivity_label
,coalesce(kitchen_repair,0) kitchen_repair,coalesce(balcony_repair,0) balcony_repair,coalesce(bathroom_repair,0) bathroom_repair,
t1.house_type_name,--房屋类型
coalesce(t1.deliver_year,round(datediff(getdate(),t3.consign_date,'dd')/365,2)) deliver_year,--房屋年限
case when t4.residence_status=0 then '未知' 
WHEN residence_status=1 THEN '自住-常住' 
when residence_status=2 then '自住-非常住' 
when residence_status=3 then '出租中'
when residence_status=4 then '空置' end residence_status,--居住状态
t5.family_structure,
case when t6.decorate_year<1 then '一年以内'
WHEN t6.decorate_year<5 then '1-5年'
WHEN t6.decorate_year<10 THEN '5-10年'
WHEN t6.decorate_year>=10 THEN '10年及以上'
ELSE '未装修' END decorate_status,--装修状态
t1.property_area,--建筑面积
ppt.layout --户型
from
(select *,coalesce(GET_JSON_OBJECT(code_mapping,'$.\\@zhantu'),GET_JSON_OBJECT(code_mapping,'$.\\@zhantu_v2')) house_code,
GET_JSON_OBJECT(basic_attrs, '$.associated_entity.\\@project') project,
GET_JSON_OBJECT(basic_attrs, '$.physical_info.house_type_name') house_type_name,--房屋类型
round(datediff(getdate(),to_date(GET_JSON_OBJECT(basic_attrs, '$.property_info.property_deliver_date'),'yyyy-mm-dd hh:mi:ss'),'dd')/365,2) deliver_year,--房屋年限
GET_JSON_OBJECT(basic_attrs, '$.physical_info.property_area')  property_area
from daas_prod.ods_1400063_pride_house
    WHERE ds=max_pt('daas_prod.ods_1400063_pride_house')
    and status='ACTIVE'
    ) t1
join (
select *,coalesce(GET_JSON_OBJECT(code_mapping,'$.\\@zhantu'),GET_JSON_OBJECT(code_mapping, '$.\\@onewo_town_projects[0]')) project_code
FROM daas_prod.ods_1400063_pride_project
where ds=max_pt('daas_prod.ods_1400063_pride_project')
and status = 'ACTIVE'
) t2 on t1.project=t2.code
join weijia.dwd_yx_proj_base_indicator_detail t3 on t3.asset_code=t1.project and t3.org_tag_name='责任盘'
LEFT JOIN daas_prod.ods_1500173_house_status t4 on  t4.house_code=t1.house_code--居住状态
left join --家庭结构
(
select ch.house_war_code, 
MIN(case when label_value regexp 'family_structure_4' then 'A_三代同堂'
when label_value regexp 'family_structure_3' THEN 'B_多孩之家'
when label_value regexp 'family_structure_2' then 'C_二孩之家'
when label_value regexp 'family_structure_1' then 'D_三口之家'
when label_value regexp 'family_structure_0' then 'E_二人世界'
end)  family_structure
from vs5space.dwd_uno_meta_family_structure_label fsl
left join vs5space.ads_uno_phr_customer_house_label ch on cast(fsl.oneid as string)=ch.oneid and ch.is_valid=1
where ds=max_pt('vs5space.dwd_uno_meta_family_structure_label')
and length(label_value) >2
GROUP BY ch.house_war_code
) t5 on t5.house_war_code=t1.house_code
left join --装修备案年限
(select house_code_pride,min(ROUND(datediff(getdate(),construct_complete_date,'dd')/365,2)) decorate_year
from weijia.dwd_decoration_beian_records
group by house_code_pride) t6 on t6.house_code_pride=t1.code
left join rp on rp.house_code=t1.code
left join vs5space.dwd_house_price_sensitivity_label ps on ps.house_code=t1.house_code
left join daas_prod.dwd_1200721_property ppt on ppt.propertycode=t1.house_code and ppt.ds=max_pt('daas_prod.dwd_1200721_property')
where t1.code is not null