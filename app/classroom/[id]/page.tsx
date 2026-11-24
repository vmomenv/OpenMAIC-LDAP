import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { resolveClassroomPageAccess } from '@/lib/classroom/page-access';

import ClassroomDetailPage from './classroom-page';

export const dynamic = 'force-dynamic';

/**
 * The standalone classroom route. In an LDAP deployment the middleware lets
 * the request reach this server component so the course's published state can
 * be checked against the database: a published course opens for an anonymous
 * visitor, anything else keeps the sign-in redirect.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await resolveClassroomPageAccess(id, new Headers(await headers()));

  if (access.kind === 'redirect') {
    const next = encodeURIComponent(access.next);
    redirect(`/login?next=${next}`);
  }

  return (
    <ClassroomDetailPage guest={access.guest} guestLocalRecords={access.guestLocalRecords} />
  );
}
