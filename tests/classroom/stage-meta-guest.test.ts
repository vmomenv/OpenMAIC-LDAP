import { describe, expect, it, vi } from 'vitest';

import { fetchStageMeta } from '@/lib/classroom/stage-meta-client';

import zhCN from '../../lib/i18n/locales/zh-CN.json';
import enUS from '../../lib/i18n/locales/en-US.json';

describe('stage meta guest permissions', () => {
  it('reads the five visitor capabilities from the sidecar', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        isOwner: true,
        isPublic: true,
        publishedAt: 1,
        generationComplete: true,
        guestQuiz: true,
        guestTts: false,
        guestChat: true,
        guestPbl: false,
        guestLocalRecords: true,
      }),
    );

    const result = await fetchStageMeta('stage-1', fetchImpl as never);
    expect(result).toMatchObject({
      outcome: 'found',
      meta: {
        guestQuiz: true,
        guestTts: false,
        guestChat: true,
        guestPbl: false,
        guestLocalRecords: true,
      },
    });
  });

  it('has copy for the visitor-access submenu in both base locales', () => {
    for (const locale of [zhCN, enUS]) {
      for (const key of [
        'menu',
        'share',
        'shareHint',
        'quiz',
        'tts',
        'chat',
        'pbl',
        'localRecords',
        'copyLink',
        'copied',
      ]) {
        expect(
          typeof (locale as unknown as Record<string, Record<string, string>>).guestAccess?.[key],
        ).toBe('string');
      }
    }
  });
});
