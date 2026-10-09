import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptMobile, maskMobile } from '../../common/crypto.util';
import { ChannelAdapter } from '../../adapters/channel.adapter';

/**
 * 推送记录查询与人工干预：列表（脱敏）、原因码分组（含 NO_MOBILE 数据缺口口径）、
 * 中止未发明细、失败重推。任何明文手机号不出服务边界。
 */
@Injectable()
export class PushRecordsService {
  private readonly logger = new Logger(PushRecordsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channel: ChannelAdapter,
    private readonly config: ConfigService,
  ) {}

  private mask(enc: string | null): string | null {
    if (!enc) return null;
    try {
      return maskMobile(
        decryptMobile(enc, this.config.getOrThrow<string>('MOBILE_ENC_KEY_BASE64')),
      );
    } catch {
      this.logger.warn('密文手机号解密失败，展示为 ****（静默掩盖会更危险，故明确提示）');
      return '解密失败';
    }
  }

  async list(query: { taskId?: bigint; status?: string; reasonCode?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 20);
    const where: Prisma.PushDetailWhereInput = {};
    if (query.taskId) where.pushTaskId = query.taskId;
    if (query.status) where.status = query.status as Prisma.PushDetailWhereInput['status'];
    if (query.reasonCode) where.reasonCode = query.reasonCode;

    const [total, rows] = await Promise.all([
      this.prisma.pushDetail.count({ where }),
      this.prisma.pushDetail.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          package: { select: { name: true, code: true } },
          house: { select: { communityName: true, houseName: true, city: true } },
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: rows.map((r) => ({
        id: r.id.toString(),
        pushTaskId: r.pushTaskId.toString(),
        status: r.status,
        reasonCode: r.reasonCode,
        package: r.package,
        communityName: r.house?.communityName ?? null,
        houseName: r.house?.houseName ?? null,
        city: r.house?.city ?? null,
        mobileMasked: this.mask(r.contactMobileEnc),
        sentAt: r.sentAt,
        failReason: r.failReason,
        deferredUntil: r.deferredUntil,
        createdAt: r.createdAt,
      })),
    };
  }

  /** 原因码分组统计：NO_MOBILE 与房屋冷却等在前端归入「数据缺口/频控」分组（分组表在前端）。 */
  reasonSummary(taskId?: bigint) {
    const where: Prisma.PushDetailWhereInput = taskId ? { pushTaskId: taskId } : {};
    return this.prisma.pushDetail.groupBy({
      by: ['status', 'reasonCode'],
      where,
      _count: { _all: true },
    });
  }

  /** 中止：仅 queued/deferred 可中止，写 halt 原因码（用 suppressed + 人工中止标记）。 */
  async halt(id: bigint) {
    const row = await this.prisma.pushDetail.findUniqueOrThrow({ where: { id } });
    if (row.status !== 'queued' && row.status !== 'deferred') {
      throw new Error(`当前状态 ${row.status} 不可中止（仅 queued/deferred 可中止）`);
    }
    return this.prisma.pushDetail.update({
      where: { id },
      // 人工中止不是 14 个系统闸门原因码之一：reasonCode 保持空，用 failReason 记录人工动作
      data: { status: 'suppressed', reasonCode: null, failReason: 'MANUAL_HALT', deferredUntil: null },
    });
  }

  /** 失败重推（频控在跑批时已判定；重推是人工动作，限 failed 明细，仍逐条回执，不批量静默）。 */
  async retry(id: bigint) {
    const row = await this.prisma.pushDetail.findUniqueOrThrow({ where: { id } });
    if (row.status !== 'failed') throw new Error(`仅 failed 明细可重推，当前为 ${row.status}`);
    const receipt = await this.channel.send({
      houseId: row.houseId,
      mobileEnc: row.contactMobileEnc,
      packageId: row.packageId,
      msgType: row.msgType,
    });
    return this.prisma.pushDetail.update({
      where: { id },
      data: receipt.ok
        ? { status: 'sent', sentAt: new Date(), channelMsgId: receipt.channelMsgId, failReason: null }
        : { failReason: receipt.failReason },
    });
  }
}
