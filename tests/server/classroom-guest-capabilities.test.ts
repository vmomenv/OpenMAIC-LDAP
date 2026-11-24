import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  assertGuestCapability: vi.fn(),
}));

vi.mock('@/lib/server/identity/classroom-guest/access', () => ({
  assertGuestCapability: mocks.assertGuestCapability,
}));
vi.mock('server-only', () => ({}));

const refusal = () =>
  Response.json({ error: { code: 'GUEST_CAPABILITY_DISABLED' } }, { status: 403 });

beforeEach(() => {
  mocks.assertGuestCapability.mockReset();
});

describe('guest capability gates', () => {
  it('gates quiz grading', async () => {
    const block = refusal();
    mocks.assertGuestCapability.mockResolvedValue(block);
    const { POST } = await import('@/app/api/quiz-grade/route');
    const response = await POST(
      new NextRequest('http://localhost/api/quiz-grade', {
        method: 'POST',
        body: '{}',
      }),
    );
    expect(response).toBe(block);
    expect(mocks.assertGuestCapability).toHaveBeenCalledWith(expect.anything(), 'quiz');
  });

  it('gates TTS and voice registration', async () => {
    const block = refusal();
    mocks.assertGuestCapability.mockResolvedValue(block);
    const [tts, voice] = await Promise.all([
      import('@/app/api/generate/tts/route'),
      import('@/app/api/generate/voice/route'),
    ]);
    const request = () =>
      new NextRequest('http://localhost/api/generate/tts', { method: 'POST', body: '{}' });
    await expect(tts.POST(request())).resolves.toBe(block);
    await expect(voice.POST(request())).resolves.toBe(block);
    expect(mocks.assertGuestCapability).toHaveBeenCalledWith(expect.anything(), 'tts');
  });

  it('gates the Pi chat surface', async () => {
    const block = refusal();
    mocks.assertGuestCapability.mockResolvedValue(block);
    const { POST } = await import('@/app/api/chat/pi/route');
    const response = await POST(
      new NextRequest('http://localhost/api/chat/pi', { method: 'POST', body: '{}' }),
    );
    expect(response).toBe(block);
    expect(mocks.assertGuestCapability).toHaveBeenCalledWith(expect.anything(), 'chat');
  });

  it('gates PBL v3 entry routes', async () => {
    const block = refusal();
    mocks.assertGuestCapability.mockResolvedValue(block);
    const { GET } = await import('@/app/api/pbl/v3/events/route');
    const response = await GET(new NextRequest('http://localhost/api/pbl/v3/events?id=x'));
    expect(response).toBe(block);
    expect(mocks.assertGuestCapability).toHaveBeenCalledWith(expect.anything(), 'pbl');
  });
});
