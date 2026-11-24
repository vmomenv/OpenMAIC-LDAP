'use client';

import { ClassroomSurface } from '@/components/classroom/ClassroomSurface';
import { useParams } from 'next/navigation';

export default function ClassroomDetailPage({
  guest = false,
  guestLocalRecords = false,
}: {
  readonly guest?: boolean;
  readonly guestLocalRecords?: boolean;
}) {
  const params = useParams<{ id: string }>();

  return (
    <ClassroomSurface
      classroomId={params.id}
      variant="page"
      guest={guest}
      guestLocalRecords={guestLocalRecords}
    />
  );
}
