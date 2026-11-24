import { sandboxBody, sandboxPrincipalResponse } from '@/lib/server/sandbox/http';
import { applicationRequest } from '@/lib/server/pbl-v3/application';

import { assertGuestCapability } from '@/lib/server/identity/classroom-guest/access';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const refusal = await assertGuestCapability(request, 'pbl');
  if (refusal) return refusal;

  return sandboxPrincipalResponse(request, async (principal) =>
    Response.json(await applicationRequest(principal, await sandboxBody(request))),
  );
}
