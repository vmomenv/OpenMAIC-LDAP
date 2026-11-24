import { sandboxPrincipalResponse } from '@/lib/server/sandbox/http';
import { sandboxInvalid } from '@/lib/sandbox/errors';
import { learningEventResponse } from '@/lib/server/pbl-v3/event-stream';

import { assertGuestCapability } from '@/lib/server/identity/classroom-guest/access';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const refusal = await assertGuestCapability(request, 'pbl');
  if (refusal) return refusal;

  return sandboxPrincipalResponse(request, async (principal) => {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) throw sandboxInvalid('A learning session is required.');
    return learningEventResponse(principal, id, request.signal);
  });
}
