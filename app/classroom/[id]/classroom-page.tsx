'use client';

import { ClassroomSurface } from '@/components/classroom/ClassroomSurface';
import { setGuestRecordPolicy } from '@/lib/runtime/guest-records';
import { useParams } from 'next/navigation';

export default function ClassroomDetailPage({
  guest = false,
  guestLocalRecords = false,
}: {
  readonly guest?: boolean;
  readonly guestLocalRecords?: boolean;
}) {
  const params = useParams<{ id: string }>();

  // Chosen before any child can touch the runtime store: a guest keeps the
  // session either in this browser or in memory, never on the server.
  setGuestRecordPolicy({ guest, localRecords: guestLocalRecords });

  return (
    <ClassroomSurface
      classroomId={params.id}
      variant="page"
      guest={guest}
      guestLocalRecords={guestLocalRecords}
    />
  );
}
