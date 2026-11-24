import { sandboxBody, sandboxPrincipalResponse } from '@/lib/server/sandbox/http';
import { sandboxInvalid } from '@/lib/sandbox/errors';
import { LearningStore } from '@/lib/server/pbl-v3/store';

import { assertGuestCapability } from '@/lib/server/identity/classroom-guest/access';

export const runtime = 'nodejs';

/** Idempotent UI acknowledgement; never advances a learning revision or allocates compute. */
export async function POST(request: Request) {
  const refusal = await assertGuestCapability(request, 'pbl');
  if (refusal) return refusal;

  return sandboxPrincipalResponse(request, async (principal) => {
    const body = await sandboxBody(request);
    if (typeof body.studyId !== 'string' || !body.studyId)
      throw sandboxInvalid('A learning session is required.');
    const store = await LearningStore.open();
    await store.completeOnboarding(body.studyId, principal.ownerId);
    return Response.json({ onboardingCompleted: true });
  });
}
