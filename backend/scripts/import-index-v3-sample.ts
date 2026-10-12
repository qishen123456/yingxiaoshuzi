/**
 * Import the 0924 house samples embedded in demo/index-v3.html into a DEV/TEST database.
 *
 * Safety properties:
 * - Must be explicitly enabled with ALLOW_INDEX_V3_SAMPLE_IMPORT=1.
 * - Refuses NODE_ENV=production.
 * - Creates synthetic IDX3-SAMPLE-* IDs because index-v3 has no canonical Pride/Zhantu IDs.
 * - Stores masked phone values only in demo_mobile_masked. contact_mobile_enc and customer_key_hash
 *   stay null, so the imported rows cannot be treated as real sendable contacts.
 * - Idempotent upsert: it touches only IDX3-SAMPLE-* IDs, never overwrites canonical house IDs.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

function extractArray(source: string, name: string): unknown[] {
  const declaration = new RegExp('\\bvar\\s+' + name + '\\s*=');
  const match = declaration.exec(source);
  if (!match) throw new Error('在 index-v3.html 中找不到数组：' + name);
  let start = match.index + match[0].length;
  while (/\\s/.test(source[start] ?? '')) start++;
  if (source[start] !== '[') throw new Error(name + ' 不是数组字面量');
  const begin = start;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) return JSON.parse(source.slice(begin, i + 1)) as unknown[];
    }
  }
  throw new Error('数组没有结束：' + name);
}

type LegacyHouse = [number, string, string, string, string, number, number, string];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('拒绝在 NODE_ENV=production 中导入 index-v3 样本。');
  if (process.env.ALLOW_INDEX_V3_SAMPLE_IMPORT !== '1') {
    throw new Error('这是开发/测试样本导入。请显式设置 ALLOW_INDEX_V3_SAMPLE_IMPORT=1 后再执行。');
  }

  const htmlPath = resolve(process.cwd(), '..', 'demo', 'index-v3.html');
  const html = await readFile(htmlPath, 'utf8');
  const projects = extractArray(html, 'PROJECTS') as string[];
  const phones = extractArray(html, 'PHONES') as string[];
  const houses = extractArray(html, 'HOUSES') as LegacyHouse[];
  if (houses.length !== 1053) throw new Error('预期导入 1053 套样本，实际读取到 ' + houses.length + ' 套；请先核对 index-v3 数据源。');

  const statDate = new Date('2026-09-24T00:00:00.000Z');
  const syncedAt = new Date();
  const rows = houses.map((house, index) => {
    const [projectIndex, fullName, waterRaw, envRaw, familyRaw, phoneIndex] = house;
    const projectName = projects[projectIndex];
    if (!projectName || !fullName || !phones[phoneIndex]) throw new Error('index-v3 样本字段异常，记录行：' + (index + 1));
    const houseName = fullName.startsWith(projectName) ? fullName.slice(projectName.length) : fullName;
    const city = projectName.startsWith('东莞') ? '东莞' : projectName.startsWith('深圳') ? '深圳' : '未知';
    return {
      houseId: 'IDX3-SAMPLE-' + String(index + 1).padStart(4, '0'),
      zhantuHouseId: null,
      houseName,
      communityId: 'IDX3-DEMO-PROJECT-' + projectIndex,
      communityName: projectName,
      region: '华南',
      city,
      branch: null,
      station: null,
      stationCode: null,
      ownerNameMasked: null,
      contactMobileEnc: null,
      customerKeyHash: null,
      demoMobileMasked: phones[phoneIndex],
      labels: {
        water_tags: waterRaw ? waterRaw.split(',').map((v) => v.trim()).filter(Boolean) : [],
        env_tags: envRaw ? envRaw.split(',').map((v) => v.trim()).filter(Boolean) : [],
        family_structure: familyRaw ? [familyRaw] : [],
        // 与 index-v3 的 houseTags() 预览口径保持一致；不将其视为生产底账字段真值。
        decorate_status: ['未装修'],
      },
      statDate,
      syncedAt,
      labelVersion: 'index-v3-0924-sample',
    };
  });

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  try {
    const prisma = app.get(PrismaService);
    let imported = 0;
    for (let offset = 0; offset < rows.length; offset += 100) {
      const slice = rows.slice(offset, offset + 100);
      await prisma.$transaction(slice.map((row) => prisma.houseLabelSnapshot.upsert({
        where: { houseId: row.houseId },
        create: row,
        update: {
          houseName: row.houseName, communityId: row.communityId, communityName: row.communityName,
          region: row.region, city: row.city, labels: row.labels, demoMobileMasked: row.demoMobileMasked,
          statDate: row.statDate, syncedAt: row.syncedAt, labelVersion: row.labelVersion,
          ownerNameMasked: null, contactMobileEnc: null, customerKeyHash: null, zhantuHouseId: null,
        },
      })));
      imported += slice.length;
    }
    console.log('已导入 index-v3 0924 样本：' + imported + ' 套房屋；项目：' + projects.join(' / '));
    console.log('号码字段只保留原样脱敏显示值。contact_mobile_enc / customer_key_hash 为空，禁止真实触达。');
    console.log('样本使用 IDX3-SAMPLE-* 合成主键，不会覆盖真实 Pride 房屋主键。');
    console.log('每套房屋将按当前研选数据库 mapping_rule 重新计算产品命中；旧 index-v3 SQL 命中结果不作为新规则结果。');
  } finally {
    await app.close();
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
