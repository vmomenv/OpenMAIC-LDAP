import { sandboxPrincipalResponse } from '@/lib/server/sandbox/http';
import { conversationPage } from '@/lib/server/pbl-v3/conversation-page';

import { assertGuestCapability } from '@/lib/server/identity/classroom-guest/access';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const refusal = await assertGuestCapability(request, 'pbl');
  if (refusal) return refusal;

  return sandboxPrincipalResponse(request, async (principal) =>
    Response.json(await conversationPage(principal, new URL(request.url).searchParams)),
  );
}
