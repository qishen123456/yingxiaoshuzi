import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { decryptMobile } from '../common/crypto.util';

/**
 * 触达通道适配器（ARCHITECTURE §10：不自建通道，只对接公司现有短信/企微 HTTP API）。
 * 骨架默认 DRY_RUN=true：不调用任何外部系统，直接回执成功（channelMsgId 用 mock 前缀）。
 * 真实接入：新增 HttpChannelAdapter 实现同一接口并按渠道路由；失败必须返回 ok=false + failReason，
 * 不得在适配器内抛异常中断整批发送（runner 逐条落 failed，保证其他业主正常触达）。
 */

export interface SendCommand {
  houseId: string;
  mobileEnc: string | null;
  packageId: bigint | null;
  msgType: string;
}

export interface SendReceipt {
  ok: boolean;
  channelMsgId?: string;
  failReason?: string;
}

@Injectable()
export class ChannelAdapter {
  private readonly logger = new Logger(ChannelAdapter.name);

  constructor(private readonly config: ConfigService) {}

  async send(cmd: SendCommand): Promise<SendReceipt> {
    const dryRun = this.config.get<string>('DRY_RUN', 'true') !== 'false';
    if (dryRun) {
      // dry-run：解密仅用于验证密文可用，不打印、不外发
      if (cmd.mobileEnc) {
        try {
          decryptMobile(cmd.mobileEnc, this.config.getOrThrow<string>('MOBILE_ENC_KEY_BASE64'));
        } catch {
          return { ok: false, failReason: 'MOBILE_DECRYPT_ERROR' };
        }
      }
      return { ok: true, channelMsgId: `mock-${randomUUID()}` };
    }

    // TODO(通道拉通)：按 packageId/渠道配置路由到公司企微/短信 HTTP API（同步受理 + 异步回执）。
    this.logger.warn(`真实通道未接入，houseId=${cmd.houseId} 按失败处理，避免假装已发送`);
    return { ok: false, failReason: 'CHANNEL_NOT_CONFIGURED' };
  }
}
