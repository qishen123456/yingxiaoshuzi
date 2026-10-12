# index-v3 样本导入（开发/测试专用）

主研选系统的房屋筛选页面读取 PostgreSQL 的 `house_label_snapshot`，不从浏览器直接加载旧 HTML 数组。本命令用于把 `demo/index-v3.html` 中的 0924 批次 1053 套脱敏房屋样本导入开发/测试数据库，从而在 React 主系统中使用同一批房屋展示和验证筛选流程。

## 前置条件

1. 已先执行数据库 schema 变更（包括 `demo_mobile_masked` 列）并运行 `npx prisma generate`。
2. 已执行产品包、标签字典、映射规则种子。
3. 确认当前 `.env` 指向的是**开发/测试数据库**。脚本在 `NODE_ENV=production` 下会拒绝执行。
4. 这些样本没有真实 Pride / 战图房屋编码，脚本使用 `IDX3-SAMPLE-0001` 等合成 ID。导入前请理解该限制。

## 执行方式

```bash
cd backend
ALLOW_INDEX_V3_SAMPLE_IMPORT=1 npm run demo:index-v3-sample
```

脚本会读取 `../demo/index-v3.html` 中现有的 `PROJECTS`、`RELATIONS`、`PHONES`、`HOUSES` 数组，并幂等 upsert 1053 套房屋。只操作 `IDX3-SAMPLE-*` 前缀的数据，不覆盖真实房屋 ID。

## 数据与触达边界

- 项目、房屋名、水路标签、环境标签、家庭结构和旧版预览中的装修状态会写入现有快照字段，产品命中由**当前研选数据库的规则引擎**重算，不沿用旧版数组里的 `原 SQL 命中` 作为新规则结果。
- 原 HTML 只有脱敏手机号，因此写入专门的 `demo_mobile_masked` 展示列；`contact_mobile_enc` 和 `customer_key_hash` 保持空值。这些行只可用于前端展示和流程验证，不能作为真实触达对象。
- 每次保存人群包和推送批次都会保留房屋快照；推送确认依旧只是记录批次，不会调用短信 / 企微通道。
- 该脚本不应运行在生产数据库。生产系统应由 DataWorks 将真实 Pride 房屋编码、联系方式加密值和标签快照同步至正式表。
