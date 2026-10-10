# 数据资产接入契约（DATA-CONTRACT）

> 版本：v1.0 | 日期：2026-09-22
> 性质：本系统与上游真实数据资产之间的**字段级契约**，是 Spec、DataWorks 同步配置、种子数据的共同事实源。
> 上游事实来源（只读，本系统不改造）：
> - 标签：MaxCompute `weijia.dwd_yanxuan_responsible_project_hosue_label`（生产脚本作者：唐爱玲，T+1 全量 `INSERT OVERWRITE`）
> - 线索：ADB PostgreSQL `yanxuan.ads_yx_clue_full_detail`（T+1 `TRUNCATE + INSERT` 全量快照，约 180 列）
> - 生产脚本原件存档：`资料/1.标签.sql`、`资料/2.线索full.sql`
> 铁律：**上游生产 SQL 一字不改**；本系统只做同步、映射、消费。

---

## 1. 数据源总览与同步拓扑

```text
┌─────────────────────────────── 上游（既有资产，只读） ───────────────────────────────┐
│ MaxCompute（weijia / vs5space / daas_prod 等 schema）                                 │
│   └─ weijia.dwd_yanxuan_responsible_project_hosue_label  房屋标签宽表（约125.7万行）   │
│ ADB PostgreSQL（yanxuan / other / meiju / caster schema）                             │
│   ├─ yanxuan.ads_yx_clue_full_detail                     线索全量宽表（T+1 快照）      │
│   ├─ meiju.ods_rich_rich_user_house / _user_phone        住这儿 用户-房屋-手机号        │
│   ├─ caster.cas_qywx_customer_info / _member_rel         企微外部联系人手机号          │
│   └─ other.cdw_crm_customer                              CRM 人房关系（业主识别）      │
└──────────────────────────────────────────────────────────────────────────────────────┘
                 │ DataWorks 数据集成（每日 02:00，两源各自独立节点）
                 │  节点① MaxCompute Reader → PostgreSQL Writer（标签，含补号子查询）
                 │  节点② ADB PG Reader   → PostgreSQL Writer（线索）
                 ▼
┌─────────────────────────── 本系统 RDS PostgreSQL 16 ───────────────────────────┐
│  house_label_snapshot（房屋标签快照，upsert 覆盖，只留最新）                    │
│  lead_record（线索镜像 + 归因回填字段，lead_id 幂等）                            │
│  + 规则/产品包/频控/推送等系统自有表（见 ARCHITECTURE §6）                       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

> 对 ARCHITECTURE §3.7 的修正：原设计只有「MaxCompute → RDS」一条同步链路。**实际存在第二数据源 ADB PostgreSQL**（线索宽表与全部补号辅助表均在 ADB），DataWorks 需新增一个 **AnalyticDB PostgreSQL Reader → PostgreSQL Writer** 节点。两节点相互独立，任一失败只影响对应闸门（见 §6 降级），不互相阻塞。

| 同步对象 | 源 | 目标表 | 频率 | 写入策略 | 就绪判定 |
|----------|----|--------|------|----------|----------|
| 房屋标签+手机号 | MC 标签宽表（LEFT JOIN ADB 补号视图，见 §5） | `house_label_snapshot` | 每日 02:00 | `INSERT ... ON CONFLICT(house_id) DO UPDATE` | 当日分区行数 > 0 且与近 7 日均值偏差 < 30% |
| 线索 | ADB `ads_yx_clue_full_detail` | `lead_record` | 每日 02:30 | `lead_id` 幂等 upsert，归因字段不被覆盖 | `max(synced_at)` 距跑批时刻 ≤ 2 天 |
| 跑批 | 本系统 | `campaign_task` / `push_detail` | 每日 07:30 | `stat_date` 唯一约束 + advisory lock | 两源就绪才允许执行 |

> **标签表无分区字段**：上游为每日全量覆写表，不带 `dt`。同步时由 DataWorks 节点以调度业务日期写入目标表 `stat_date`，不得依赖源表分区裁剪。

---

## 2. 房屋标识键拓扑（跨系统 join 的命根子）

系统内存在**两套房屋编码体系**，全部关联必须显式声明用哪一套，禁止凭名字猜测：

| 编码体系 | 含义 | 标签宽表 | 线索宽表 | 辅助表 |
|----------|------|----------|----------|--------|
| **pride code（蝶发房屋编码）** | 物业房屋字典主键，标签表 `code`，**本系统 `house_id` 采用此码** | `code` | `house_code`（源自 main.`house_x_code`，满盘脚本 m10 亦按此码关联） | `ods_rich_rich_user_house.house_code`、`ods_diana_t_house_problem_label.house_code`、`cdw_house_improvements_records_cleaning.housecode_pride` |
| **战图房屋编码** | 战图阵地体系，备用核对键 | `house_code`（JSON `code_mapping.@zhantu`） | `zhantu_housecode`（经 `other.cdw_pride_pride_house` 反查） | `cdw_crm_customer.houseid`、`dws_zhantu_house_status_and_factual_info.property_code` |
| 项目编码 | 责任盘项目 | `asset_code` | `project_code` | `dwd_yx_proj_base_indicator_detail.asset_code`（`org_tag_name='责任盘'`） |

**关联规则（写死为契约）**：

1. 线索 → 房屋：优先 `线索.house_code = 标签.code`（pride 码）；pride 码为空时退回 `线索.zhantu_housecode = 标签.house_code`（战图码），并在 `lead_record` 打 `house_match_type=zhantu_fallback` 标记，供覆盖率核对。
2. 两套码都对不上 → 不丢线索，`house_id` 置空、进关联失败池（接口可查、可人工复核），该线索只参与客户级（手机号 HMAC）归因，不参与房屋级圈选。
3. 组织权限维度以标签宽表为准：`region_name / city_group_name / business_name / fwz_org_code / fwz_org`；线索侧同名字段仅用于线索表单独查询展示。
4. 责任盘口径：标签宽表在生产时已以 `org_tag_name='责任盘'` 内连接过滤，故同步进来的房屋**天然全部是责任盘**；线索侧另有 `is_responsibility` 字段，同步时必须显式过滤 `is_responsibility = true`（或与标签快照 inner join 兜底）。

---

## 3. 标签字段映射契约（tag_dictionary 种子的事实源）

> 关键事实：① 源表多值标签是 **`wm_concat` 逗号拼接字符串**（如 `卫生间漏水,厨房漏水`），**不是数组**；规则引擎对多值标签一律做「拆分后包含」匹配，同步时可拆为 PG `text[]` 落 `labels` JSONB。② 源列名为拼音，系统内使用英文 `tag_key`，映射关系如下，种子 SQL 中以 `source_column` 留存溯源。③ 枚举值以生产 SQL 实际输出为准，与 PRD §4 建议值有出入的，**以本表为准**。

| tag_group | tag_key（系统内） | source_column（MC 真实列） | 值类型 | 真实枚举 / 格式 | 与 PRD §4 的差异说明 |
|-----------|------------------|----------------------------|--------|-----------------|---------------------|
| water | `water_tags` | `shuilu_label` | multi_enum（逗号串） | 卫生间漏水 / 厨房漏水 / 阳台漏水 / 水管老化 | 多值字符串，非 array |
| electric | `electric_tags` | `dianlu_tag` | multi_enum | 跳闸 / 插座故障 / 电路老化 | 同上 |
| appliance | `appliance_tags` | `jiadian_tag` | multi_enum | 空调故障 / 热水器故障 / 冰箱故障 | 仅维修单 (`matter_type_1='维修'`) 产生，天然稀疏 |
| env | `env_tags` | `envir_tag` | multi_enum | 墙面发霉 / **渗水/返潮** / 厨房老化 / 卫生间老化 / 阳台老化 / 瓷砖开裂空鼓 | 真实值为「渗水/返潮」（带斜杠），PRD 写的「渗水返潮」作废 |
| price | `price_sensitivity` | `price_sensitivity_label` | enum | 性价比优先 等（取值随上游扩展，同步时容忍未知值） | — |
| residence | `residence_status` | `residence_status` | enum | 未知 / 自住-常住 / 自住-非常住 / 出租中 / 空置 | 一致 |
| family | `family_structure` | `family_structure` | enum | **A_三代同堂 / B_多孩之家 / C_二孩之家 / D_三口之家 / E_二人世界** | 真实值带 `A_`~`E_` 前缀，规则与界面必须以前缀值匹配，展示时去前缀 |
| decoration | `decorate_status` | `decorate_status` | enum | 未装修 / 一年以内 / 1-5年 / 5-10年 / 10年及以上 | 「未装修」是 CASE ELSE 兜底，**包含装修备案关联不到的房屋**，语义=「未知/未备案装修」，配置规则时须知其含义偏宽 |
| repair | `repair_kitchen` | `kitchen_repair` | int | ≥0，近 365 天线索备注正则命中次数 | — |
| repair | `repair_balcony` | `balcony_repair` | int | ≥0 | — |
| repair | `repair_bathroom` | `bathroom_repair` | int | ≥0 | — |
| house | `house_type_name` | `house_type_name` | string | 房屋类型 | — |
| house | `deliver_year` | `deliver_year` | numeric(5,2) | 交付年限（年，2 位小数；缺失时以项目交付日期 `consign_date` 推算） | PRD 标的 int/string 不准，实际为小数 |
| house | `property_area` | `property_area` | numeric | 建筑面积（㎡） | — |
| house | `layout` | `layout` | string | 户型 | — |
| house（缺口） | `house_feature_tags` | **当前不存在** | multi_enum | 规划值：带浴缸户型 等 | **GAP-2**，见 §6 |
| org | `region / city / branch / station / station_code` | `region_name / city_group_name / business_name / fwz_org / fwz_org_code` | string | 组织权限维度 | — |
| org | `community_id / community_name` | `asset_code / asset_name` | string | 责任盘项目 | — |
| 主键 | `house_id` | `code` | string | pride 房屋编码（NOT NULL，同步 WHERE 已保证） | — |
| 备用键 | `zhantu_house_id` | `house_code` | string | 战图房屋编码 | — |
| 名称 | `house_name` | `name` | string | 房屋名称 | — |

**多值标签匹配语义（规则引擎实现契约）**：

- `op=contains_any`：标签串拆分（分隔符为半角逗号）后与值列表有交集即命中（多值标签的默认操作符）。
- `op=contains_all`：全部包含。
- 空值 / 空串视为「无该标签」，`contains_any` 对空值恒为 false。
- 单值枚举沿用 `eq / in / not_in`；数值标签沿用 `gte / lte / between`。

---

### 3.1 产品规则页的标签类别与标签值维护表

产品规则页的标签类别和可选值都由数据库提供，不在前端维护固定列表。当前初始化仅开放水路标签、环境标签、家庭结构、装修状态四类；既有其他字段仍保留在 `tag_dictionary`，但默认不显示在产品规则页。

**新增一整个标签类别**时，在 `tag_dictionary` 建立一条类别记录并设置 `rule_enabled = true`，再把可选值逐行写入 `tag_value`。示例：

```sql
-- ① 新增可用于规则的枚举类别
INSERT INTO tag_dictionary
  (tag_group, tag_key, tag_name, value_type, enum_values, source_column, rule_enabled)
VALUES
  ('repair', 'pipe_condition_tags', '管道状况标签', 'multi_enum',
   '[]'::jsonb, 'pipe_condition_tag', true)
ON CONFLICT (tag_key) DO UPDATE
SET tag_name = EXCLUDED.tag_name,
    value_type = EXCLUDED.value_type,
    source_column = EXCLUDED.source_column,
    rule_enabled = true;

-- ② 给新类别登记可选值
INSERT INTO tag_value (tag_key, tag_value, sort_order, status)
VALUES
  ('pipe_condition_tags', '管道老化', 10, 'enabled'),
  ('pipe_condition_tags', '接口渗漏', 20, 'enabled')
ON CONFLICT (tag_key, tag_value)
DO UPDATE SET status = 'enabled';
```

只新增一个现有类别下的标签值时，无需新增 `tag_dictionary` 记录，只需往 `tag_value` 添加该类别的新值。将某个值的 `status` 改为 `disabled` 可从搜索器隐藏；将类别的 `rule_enabled` 改为 `false` 可将整个类别从产品规则选择器隐藏。前端通过 `GET /api/tags` 读取所有已启用的枚举类别和值，所以新增类别或新增标签值都无需改前端。

**数据接入边界：** 以上配置会让新类别自动出现在规则搜索器中，但不会自动把上游新物理字段灌进房屋快照。要让新类别真正参与命中，仍需确认新字段已写入 `house_label_snapshot.labels`；若该上游字段以前未接入 staging / 同步映射，还需要补充对应的数据接入映射与验收，不能把“页面可选择”当成“数据已可命中”。初始化时由 `sql/01_tag_dictionary_seed.sql` 将四类核心标签的历史 `enum_values` 迁入 `tag_value`。

---

## 4. 线索字段映射契约（ads_yx_clue_full_detail → lead_record）

### 4.1 字段映射

| lead_record（系统） | 源字段（ads_yx_clue_full_detail） | 映射逻辑 |
|---------------------|-----------------------------------|----------|
| `lead_id` | `clue_id` | 直接映射，外部主键，幂等键 |
| `customer_key` | `customer_mobile` | 归一化（去空格/连字符、去 `+86`/`86` 前缀、空值不参与）后 HMAC-SHA256，密钥由配置中心下发；与 `push_detail.customer_key_hash` 同算法同密钥（ADR-013） |
| `customer_key_type` | — | 有手机号=`mobile_hash`；无手机号有 pride 码=`house_only`（降级，仅供房屋级）；两者皆无=`unmatched` 进失败池 |
| `house_id` | `house_code` | pride 码优先；空则用 `zhantu_housecode` 回落战图码（见 §2） |
| `external_package_code` | `intention_first_type` + `intention_second_type` | 原样拼接留存 `一级\|二级`（如 `局部改造\|浴缸改淋浴`）；**二级枚举上线前必须先做取值盘点（GAP-3）** |
| `product_package_id` / `package_source` | 见 §4.3 映射字典 | external / inferred / none 三态判定链与 PRD §12.7 一致 |
| `lead_grade` | `customer_level` | 原值：A类客户/B类客户/C类客户/D类客户/E类客户 |
| `lead_status` | `business_status` | 原值：已成交 / 有需求未成交 / 无需求 / 待清洗 / 其他 / 跟进中 等（动态枚举，原样保存不翻译枚举） |
| `lead_quality` | 派生 | 按 §4.2 固定映射表翻译（写死代码，不进界面配置） |
| `source_channel` | `channel_category_l1` | 物业联动 / 朴邻联动 / PA自拓 / NPS 等 |
| `lead_created_at` | `created_time` | 线索创建时间（静默期与归因窗口基准） |
| 成交信号（看板用） | `latest_deal_time` / `order_cnt` / `performance_final` | 同步至看板扩展字段（成交是最高质量信号） |
| `stat_date` | 调度业务日期 | DataWorks 节点写入 |

### 4.2 线索质量翻译表（对齐公司统一口径，写死代码）

业务侧「有效线索」统一口径（来源：营业部/服务站指标口径文档，全公司一致）：

```text
intention_type = '自营'
AND is_repair = '否'
AND intention_first_type <> '家政维修'
AND is_test = false
AND business_status NOT IN ('其他','无需求','待清洗')
```

本系统翻译为四级质量：

| lead_quality | 判定（按优先级自上而下短路） | 业务含义 |
|--------------|------------------------------|----------|
| **A** | `business_status='已成交'`；或满足有效线索口径且 `customer_level='A类客户'` | 已成交 / 最高意向 |
| **B** | 满足有效线索口径且 `customer_level IN ('B类客户','C类客户')` | 有效意向，跟进中 |
| **C** | 满足有效线索口径且 `customer_level IN ('D类客户','E类客户')`；或等级为空 | 弱意向 / 待培育 |
| **无效** | `is_test=true` 或 `business_status IN ('其他','无需求','待清洗')` | 不计入有效线索率 |

**产品包适用口径差异（重要，防误杀）**：

- 刷新 / 浴改淋（装修向产品包）：严格套用上述有效线索口径（`is_repair='否'`、排除家政维修）。
- **渗漏（维修向产品包）不套用该过滤**：防水补漏线索本身就是维修类，计算渗漏包的线索量/有效率时，改取 `is_repair='是'` 且意向（二级/维修类型）命中防水类的线索；若错误套用装修口径，渗漏包效果将恒为 0（沉默逻辑错误）。
- 看板必须注明两个口径；线索全量同步不过滤，过滤只发生在指标计算层。

### 4.3 外部产品包编码映射字典（external → 系统产品包）

| 系统产品包 | code | 外部线索识别（满足任一） | 映射置信度 |
|-----------|------|--------------------------|-----------|
| 渗漏检测包 | `PKG-SEEP` | 维修类线索中二级意向/维修类型命中防水词表（防水、补漏、渗水、漏水、卫生间漏、厨房漏） | 依赖 GAP-3 盘点结果，词表可配但不进运营 UI |
| 浴改淋包 | `PKG-TUB2SHOWER` | `intention_first_type='局部改造'` 且二级意向命中（浴缸、浴改淋、淋浴改造） | 待 GAP-3 确认二级取值 |
| 墙面刷新包 | `PKG-REFRESH` | `intention_first_type IN ('单品焕新','局部改造')` 且二级意向命中（刷新、墙面、涂料、焕新修缮） | 待 GAP-3 确认二级取值 |

判定链严格遵循 PRD §12.7：外部码命中字典=`external`；未给码/对不上时由归因的 `first_touch_push_id` 推断=`inferred`；都不成=`none`，并按 `external_package_code` 是否为空拆「有码对不上字典 / 无码」两个子口径。

### 4.4 同步过滤与幂等

- 排除测试数据：`is_test = true` 不入 `lead_record`（同步层直接过滤，避免污染所有下游指标）。
- 责任盘：`is_responsibility = true`，或能按 §2 关联到标签快照。
- 幂等：`clue_id` 冲突时更新外部字段，但**不覆盖** `first_touch_push_id / last_touch_push_id / attributed_at`（归因回填属本系统资产）。
- 全量快照源每日 TRUNCATE 重灌：同步节点用 upsert 而非替换；源端已消失的线索不做物理删除（线索是效果资产），打 `stale_in_source` 标记即可。

---

## 5. 业主手机号来源（GAP-1 的落地方案）

**标签宽表不含任何联系方式字段**，而下发必须有手机号。按以下优先级补号（满盘脚本 m8 已验证此链路）：

| 优先级 | 来源 | 表 | 关联键 | 说明 |
|--------|------|----|--------|------|
| 1 | 住这儿注册手机号 | `meiju.ods_rich_rich_user_house uh JOIN meiju.ods_rich_rich_user_phone up ON up.user_code=uh.user_code` | pride code（`uh.house_code = 标签.code`） | 实名认证业主，质量最高；取最新绑定一个 |
| 2 | 企微外部联系人 | `caster.cas_qywx_customer_member_rel r JOIN caster.cas_qywx_customer_info i ON r.external_user_id=i.external_user_id`，`COALESCE(i.weijia_user_match_mobile, r.remark_mobiles)` | 手机号回连住儿房屋 | PA 已加微的客户，营销触达合规性更好 |
| 3 | CRM 业主 | `other.cdw_crm_customer`（`relationtype=1` 产权人） | 战图码 `houseid = 标签.house_code` | 需另接 CRM 联系方式表确认手机号字段，未确认前本源只做业主标记不做号码源 |

落地：

1. 在 ADB 侧建一个**补号视图** `yanxuan.v_marketing_house_mobile`（房屋 pride 码、战图码、归一化手机号明文、号码来源、取号时间），DataWorks 节点①在 MC 侧无法直接 JOIN ADB，故实际做法二选一：
   - **方案 A（推荐）**：补号视图先由一个独立 ADB→RDS 同步节点落入 `house_mobile_resolve`，跑批前在 RDS 内与标签快照 JOIN 拼装 `contact_mobile_enc / customer_key_hash`；
   - 方案 B：DataWorks 跨库 JOIN 节点（MC 与 ADB 联邦），维护成本高，不推荐。
2. 同一房屋多号：优先级 1>2>3，同源取最新；多成员号码全部留存 `house_mobile_resolve`，频控按**号码**与**房屋**双锚点计数（家庭去重见 ARCHITECTURE §8 闸门4）。
3. 无号码房屋照常参与规则命中预览与统计，但不进入下发清单，原因码 `NO_MOBILE`（**新增第 14 个原因码候选**，见 §7 待决）。
4. 号码合规：明文只在 ADB 视图与同步管道中出现；RDS 只存密文（随机 IV，下发时解密）+ HMAC（关联用）；界面默认脱敏。

---

## 6. 数据缺口登记（必须在 Spec 中显式存在，不许黑箱）

| 编号 | 缺口 | 影响 | 处置 |
|------|------|------|------|
| **GAP-1** | 标签宽表无业主手机号 | 无号码则无法下发 | §5 三源补号；上线前跑覆盖率核查（目标：责任盘房屋可下发号码覆盖率 ≥ 70%，低于则先补数据再上线发送，规则/预览可先行） |
| **GAP-2** | 「带浴缸户型」在标签宽表及全库 SQL 中均不存在 | 浴改淋规则第一条件悬空，直接启用必空命中 | 候选源：① 入户调查 4 表 `ods_yx_data_collection_exhi_*` 的 `home_problem` 文本；② `meiju.ods_diana_t_house_problem_label`；③ 装修备案明细。**上线前用探查 SQL（§8 Q2）确认**；确认前浴改淋规则以 `draft` 状态入库、不可启用，UI 标注「标签数据待接入」 |
| **GAP-3** | 线索二级意向 `intention_second_type` / `last_type_name` 未盘点枚举 | 外部产品包字典无法写实，`none` 占比会虚高 | 上线前执行 §8 Q3 取值盘点，据结果固化 §4.3 词表；词表首次随版本发布，不进运营配置 |
| **GAP-4** | `price_sensitivity_label` 取值域未文档化 | 价格敏感规则可能配出未知值 | §8 Q4 盘点；标签字典对该组容忍未知值并在预览中展示实际分布 |
| **GAP-5** | 标签表每日全量覆写无 `dt` | 无法做分区同步与历史追溯 | 同步时打 `stat_date`；历史标签追溯确有需求时另建 90 天保留期历史表（架构 §6 已预留方案） |
| **GAP-6** | 家庭结构值带 `A_`~`E_` 前缀、环境标签为「渗水/返潮」 | 直接按 PRD 文本配规则会永不命中 | 本契约 §3 已修正；种子 SQL 按真实值落库；界面展示去前缀、存储保留原值 |

---

## 7. 对既有设计契约的变更清单

| # | 文档 | 变更点 |
|---|------|--------|
| 1 | ARCHITECTURE §2/§3.7 | 同步拓扑增加 ADB PostgreSQL 数据源与补号节点；DataWorks 节点从 1 个变 3 个（标签/线索/补号） |
| 2 | PRD §4、ARCHITECTURE §6（6） | `house_label_snapshot` 字段以本契约 §3 为准：多值标签按字符串拆分消费、家庭结构带前缀、环境值「渗水/返潮」、年限为 numeric |
| 3 | PRD §12.2 | 线索来源由「外部 CRM/呼叫中心（未知）」改为**既有 ADB 表 `yanxuan.ads_yx_clue_full_detail`**；关联键确认为手机号 HMAC（ADR-013 一级）+ 房屋双键 |
| 4 | PRD §12.4 | 质量翻译对齐公司「有效线索」统一口径（§4.2）；维修向产品包单独口径 |
| 5 | ARCHITECTURE §8 | 原因码拟新增 `NO_MOBILE`（无号码不下发，与频控拦截区分，属数据缺口而非业主打扰风险）——需在 Spec 冻结前与原 13 原因码一并锁定 |
| 6 | OPEN-DECISIONS | 关闭「线索数据源/客户 ID/手机号归一化对齐方」三项（证据：本契约 §4-§5）；新增 GAP-1~GAP-4 四个数据缺口项 |

---

## 8. 附：上线前数据探查 SQL（在 ADB / MaxCompute 执行，结果回填本契约）

```sql
-- Q1 手机号覆盖率核查（ADB PostgreSQL）：责任盘房屋中可补到号码的比例
SELECT
  COUNT(*) AS total_house,
  COUNT(uh.phone) AS rich_mobile_house,
  ROUND(COUNT(uh.phone)::numeric / COUNT(*), 4) AS coverage
FROM weijia_house_label_snapshot_staging s
LEFT JOIN (
  SELECT uh.house_code, MAX(up.phone) AS phone
  FROM meiju.ods_rich_rich_user_house uh
  JOIN meiju.ods_rich_rich_user_phone up ON up.user_code = uh.user_code
  WHERE uh.is_deleted = 0 AND up.is_deleted = 0 AND uh.house_code IS NOT NULL AND uh.house_code <> ''
  GROUP BY uh.house_code
) uh ON uh.house_code = s.house_id;

-- Q2 浴缸标签探查（ADB PostgreSQL）：候选字段中是否出现浴缸语义
SELECT 'diana_house_problem' AS src, house_code, label_value
FROM meiju.ods_diana_t_house_problem_label
WHERE label_value ~ '浴缸|淋浴|卫浴'
LIMIT 50;
-- 入户问卷侧（MaxCompute，4 个 exhi 表并查）
SELECT house_name, home_problem
FROM vs5space.ods_yx_data_collection_exhi_zx
WHERE home_problem LIKE '%浴缸%' OR home_problem LIKE '%淋浴%'
LIMIT 50;

-- Q3 线索二级意向取值盘点（ADB PostgreSQL）：固化 external 产品包映射词表
SELECT intention_first_type, intention_second_type, COUNT(*) AS cnt
FROM yanxuan.ads_yx_clue_full_detail
WHERE is_test = false
  AND created_time >= current_date - INTERVAL '90 day'
GROUP BY 1, 2
ORDER BY 1, cnt DESC;

-- Q4 价格敏感标签取值盘点（MaxCompute）
SELECT price_sensitivity_label, COUNT(*) AS cnt
FROM weijia.dwd_yanxuan_responsible_project_hosue_label
GROUP BY 1
ORDER BY cnt DESC;

-- Q5 线索-房屋关联键覆盖率核查（ADB PostgreSQL）
SELECT
  COUNT(*) AS lead_total,
  COUNT(house_code) AS pride_key_cnt,
  COUNT(zhantu_housecode) AS zhantu_key_cnt,
  COUNT(customer_mobile) AS mobile_cnt
FROM yanxuan.ads_yx_clue_full_detail
WHERE is_test = false AND created_time >= current_date - INTERVAL '30 day';
```
