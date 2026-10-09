/**
 * 演示数据装载（可重复执行）。
 * 造数 -> 调真实 merge 服务（加密/HMAC/房屋回落走生产代码路径）-> 造频控/名单场景 -> 触发一次跑批。
 *
 * 7 套演示房覆盖：
 *   H-DM-01 渗漏命中+有号+近 15 天有家装线索        -> LEAD_HOUSE_COOLDOWN（线索闸门 0b）
 *   H-DM-02 刷新命中+有号+无线索                    -> 正常入队/发送（窗口外则 OUT_OF_WINDOW 顺延）
 *   H-DM-03 标签不命中                              -> 不产生明细
 *   H-DM-04 渗漏命中+无号                           -> NO_MOBILE（数据缺口）
 *   H-DM-05 渗漏命中+有号+近 90 天有渗漏 external 线索 + 3 天前已推 -> LEAD_PACKAGE_COOLDOWN（0a）
 *   H-DM-07 刷新命中+有号+无线索                    -> 正常入队/发送
 *   H-DM-08 刷新命中+有号+已退订                    -> OPT_OUT
 * 用法：npm run demo:data
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { HouseSyncService } from '../src/modules/sync/house-sync.service';
import { LeadSyncService } from '../src/modules/sync/lead-sync.service';
import { CampaignRunnerService } from '../src/modules/campaigns/campaign-runner.service';
import { AttributionService } from '../src/modules/attribution/attribution.service';
import { hmacCustomerKey } from '../src/common/crypto.util';
import { shanghaiCalendarDay } from '../src/common/time.util';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  const prisma = app.get(PrismaService);
  const houseSync = app.get(HouseSyncService);
  const leadSync = app.get(LeadSyncService);
  const runner = app.get(CampaignRunnerService);
  const secret = process.env.CUSTOMER_KEY_SECRET ?? 'demo-customer-key-secret-change-me';

  // date 列（stat_date）统一存上海自然日的 UTC 午夜表示
  const today = shanghaiCalendarDay(new Date());
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

  // ---------- 清理历史演示数据 ----------
  // 本脚本假设独占演示库（切勿在共享环境执行）：跑批三表与计数器先整体清空，
  // 避免中途失败残留的孤儿任务造成唯一键/外键冲突；其余业务表按演示主键精确清理。
  const demoHouseIds = ['H-DM-01', 'H-DM-02', 'H-DM-03', 'H-DM-04', 'H-DM-05', 'H-DM-07', 'H-DM-08'];
  await prisma.pushDetail.deleteMany({});
  await prisma.pushTask.deleteMany({});
  await prisma.campaignTask.deleteMany({});
  await prisma.dailySendCounter.deleteMany({});
  // 退订记录的 target_value 是号码 HMAC（不含 H-DM 前缀），按 source 清理
  await prisma.suppressionList.deleteMany({ where: { source: 'demo' } });
  await prisma.leadRecord.deleteMany({ where: { leadId: { startsWith: 'L-DM-' } } });
  await prisma.houseMobileResolve.deleteMany({ where: { houseId: { in: demoHouseIds } } });
  await prisma.houseLabelSnapshot.deleteMany({ where: { houseId: { in: demoHouseIds } } });
  await prisma.houseLabelStaging.deleteMany({ where: { houseId: { in: demoHouseIds } } });
  await prisma.houseMobileStaging.deleteMany({ where: { houseId: { in: demoHouseIds } } });
  await prisma.leadRecordStaging.deleteMany({ where: { leadId: { startsWith: 'L-DM-' } } });

  // ---------- ① 标签 staging（平铺列、逗号串，模拟 DataWorks 落库形态） ----------
  type StagingInput = Parameters<typeof prisma.houseLabelStaging.create>[0]['data'];
  const houses: StagingInput[] = [
    {
      houseId: 'H-DM-01', zhantuHouseId: 'ZT-DM-01', houseName: '1栋2单元1201',
      communityId: 'C-DM-01', communityName: '演示·水印花城', region: '华南', city: '广州',
      branch: '天河一分', station: '珠江新城服务站', stationCode: 'ST001',
      waterTagsRaw: '水管老化', decorateStatus: '5-10年', familyStructure: 'A_三代同堂',
      priceSensitivity: '中敏感', residenceStatus: '自住', statDate: today,
    },
    {
      houseId: 'H-DM-02', houseName: '3栋1单元0803',
      communityId: 'C-DM-02', communityName: '演示·翠湖山庄', region: '华南', city: '广州',
      branch: '天河二分', station: '棠下服务站', stationCode: 'ST002',
      envTagsRaw: '墙面发霉', decorateStatus: '未装修', familyStructure: 'B_多孩之家',
      statDate: today,
    },
    {
      houseId: 'H-DM-03', houseName: '5栋3单元1502',
      communityId: 'C-DM-03', communityName: '演示·隽峰苑', region: '华南', city: '广州',
      branch: '越秀一分', station: '东山口服务站', stationCode: 'ST003',
      decorateStatus: '1-3年', familyStructure: 'E_二人世界', statDate: today,
    },
    {
      houseId: 'H-DM-04', houseName: '2栋2单元0502',
      communityId: 'C-DM-04', communityName: '演示·金逸雅居', region: '华南', city: '广州',
      branch: '海珠一分', station: '琶洲服务站', stationCode: 'ST004',
      waterTagsRaw: '卫生间漏水', decorateStatus: '未装修', familyStructure: 'D_三口之家',
      statDate: today,
    },
    {
      houseId: 'H-DM-05', houseName: '6栋1单元1101',
      communityId: 'C-DM-05', communityName: '演示·珠江帝景', region: '华南', city: '广州',
      branch: '天河一分', station: '珠江新城服务站', stationCode: 'ST001',
      waterTagsRaw: '厨房漏水,水管老化', decorateStatus: '5-10年', familyStructure: 'C_二孩之家',
      statDate: today,
    },
    {
      houseId: 'H-DM-07', houseName: '8栋2单元0306',
      communityId: 'C-DM-07', communityName: '演示·保利心语', region: '华南', city: '广州',
      branch: '天河二分', station: '棠下服务站', stationCode: 'ST002',
      envTagsRaw: '瓷砖开裂空鼓', decorateStatus: '5-10年', familyStructure: 'D_三口之家',
      statDate: today,
    },
    {
      houseId: 'H-DM-08', houseName: '9栋1单元0902',
      communityId: 'C-DM-08', communityName: '演示·中海璟晖', region: '华南', city: '广州',
      branch: '越秀一分', station: '东山口服务站', stationCode: 'ST003',
      envTagsRaw: '渗水/返潮', decorateStatus: '未装修', familyStructure: 'A_三代同堂',
      statDate: today,
    },
  ];
  await prisma.houseLabelStaging.createMany({ data: houses });

  // ---------- ①b 补号 staging（04 故意无号；来源 rich/qywx） ----------
  await prisma.houseMobileStaging.createMany({
    data: [
      { houseId: 'H-DM-01', mobileRaw: '13800000001', mobileSource: 'rich', isPreferred: true },
      { houseId: 'H-DM-02', mobileRaw: '13800000002', mobileSource: 'qywx', isPreferred: true },
      { houseId: 'H-DM-03', mobileRaw: '13800000003', mobileSource: 'rich', isPreferred: true },
      { houseId: 'H-DM-05', mobileRaw: '13800000005', mobileSource: 'rich', isPreferred: true },
      { houseId: 'H-DM-07', mobileRaw: '13800000007', mobileSource: 'qywx', isPreferred: true },
      { houseId: 'H-DM-08', mobileRaw: '13800000008', mobileSource: 'rich', isPreferred: true },
    ],
  });

  // ---------- ② 线索 staging（dw_03 抽取后的平铺形态，质量/有效口径已派生） ----------
  await prisma.leadRecordStaging.createMany({
    data: [
      {
        // 渗漏维修向有效线索（external PKG-SEEP），5 天前，挂 H-DM-05
        leadId: 'L-DM-01', mobileRaw: '13800000005', customerKeyType: 'mobile_hash',
        houseIdPride: 'H-DM-05', intentionType: '自营', intentionFirstType: '家政维修',
        externalPackageCode: '卫生间防水补漏', isRepair: '是',
        leadGradeRaw: 'A类客户', leadStatusRaw: '已转单', leadQuality: 'A',
        isValidForReno: false, isValidForRepair: true, sourceChannel: '企微',
        leadCreatedAt: daysAgo(5), orderCnt: 0, statDate: today,
      },
      {
        // 家装向有效线索，但房屋两键都无法关联 -> unmatchedHouse
        leadId: 'L-DM-02', mobileRaw: '13900000099', customerKeyType: 'mobile_hash',
        intentionType: '自营', intentionFirstType: '局部改造', isRepair: '否',
        leadGradeRaw: 'B类客户', leadStatusRaw: '跟进中', leadQuality: 'B',
        isValidForReno: true, isValidForRepair: false, sourceChannel: '抖音',
        leadCreatedAt: daysAgo(2), statDate: today,
      },
      {
        // 只有战图码 ZT-DM-01 -> 回落关联 H-DM-01（house_match_type=zhantu_fallback）
        leadId: 'L-DM-03', mobileRaw: '13700000077', customerKeyType: 'mobile_hash',
        houseIdZhantu: 'ZT-DM-01', intentionType: '自营', intentionFirstType: '全屋整装',
        isRepair: '否', leadGradeRaw: 'C类客户', leadStatusRaw: '跟进中', leadQuality: 'C',
        isValidForReno: true, isValidForRepair: false, sourceChannel: '小程序',
        leadCreatedAt: daysAgo(3), statDate: today,
      },
    ],
  });

  // ---------- 走真实 merge（加密、HMAC、回落、external 字典、清明文） ----------
  await houseSync.mergeHouseLabels();
  await houseSync.mergeMobiles();
  await leadSync.mergeLeads();

  // ---------- 名单：H-DM-08 业主退订（target_value 存号码 HMAC，与闸门双键查询一致） ----------
  await prisma.suppressionList.create({
    data: {
      listType: 'unsubscribe', targetType: 'mobile_hash',
      targetValue: hmacCustomerKey('13800000008', secret) ?? '', source: 'demo',
    },
  });

  // ---------- 历史推送：H-DM-05 三天前已推过渗漏包（演示产品包冷却/线索闸门优先级） ----------
  const seepPkg = await prisma.productPackage.findUniqueOrThrow({ where: { code: 'PKG-SEEP' } });
  const seepRule = await prisma.mappingRule.findFirstOrThrow({ where: { packageId: seepPkg.id } });
  const h05 = await prisma.houseLabelSnapshot.findUniqueOrThrow({ where: { houseId: 'H-DM-05' } });
  const pastDay = new Date(today);
  pastDay.setDate(pastDay.getDate() - 3);
  const pastTask = await prisma.campaignTask.create({
    data: { statDate: pastDay, status: 'success', startedAt: daysAgo(3), finishedAt: daysAgo(3) },
  });
  const pastPushTask = await prisma.pushTask.create({
    data: { campaignTaskId: pastTask.id, status: 'done', totalCount: 1, successCount: 1, createdAt: daysAgo(3) },
  });
  await prisma.pushDetail.create({
    data: {
      pushTaskId: pastPushTask.id, houseId: 'H-DM-05', packageId: seepPkg.id, ruleId: seepRule.id,
      contactMobileEnc: h05.contactMobileEnc, customerKeyHash: h05.customerKeyHash,
      status: 'sent', sentAt: daysAgo(3), createdAt: daysAgo(3), channelMsgId: 'mock-history-05',
    },
  });
  await prisma.dailySendCounter.create({
    data: { statDate: pastDay, sentCount: 1 },
  });

  // ---------- 触发当日跑批 ----------
  console.log('演示数据装载完成，触发当日跑批……');
  const result = await runner.run(new Date());
  console.log('跑批结果：', result);
  console.log('提示：若当前时间不在可发送窗口（10:00-12:00 / 15:00-18:00），正常明细为 deferred(OUT_OF_WINDOW)，属正确行为。');

  // ---------- 归因场景：营销先行、线索后到（T+1 真实顺序） ----------
  // H-DM-01 刚收到渗漏包推送；此刻新增一条无 external 包的家装线索（同号码），
  // 归因作业应在 15 天窗口内回填首/末触推送，并把线索补记为 inferred=PKG-SEEP。
  const attribution = app.get(AttributionService);
  await prisma.leadRecord.create({
    data: {
      leadId: 'L-DM-04',
      customerKey: hmacCustomerKey('13800000001', secret) ?? '',
      customerKeyType: 'mobile_hash',
      houseId: 'H-DM-01',
      houseMatchType: 'pride',
      packageSource: 'none',
      leadGrade: 'A类客户',
      leadStatus: '跟进中',
      leadQuality: 'A',
      isValidForReno: true,
      isValidForRepair: false,
      staleInSource: false,
      sourceChannel: '企微',
      leadCreatedAt: new Date(),
      statDate: today,
      syncedAt: new Date(),
    },
  });
  const attr = await attribution.run(new Date());
  console.log('归因结果：', attr);

  await app.close();
}

main().catch((err) => {
  console.error('演示数据装载失败：', err);
  process.exit(1);
});
