/**
 * Which runtime backend an anonymous classroom visitor uses.
 *
 * The persistence bootstrap configures one store factory for the page, before
 * the classroom renders. This module carries the classroom's decision into
 * that factory: a guest keeps records in this browser when the teacher allowed
 * it, and in memory otherwise. Signed-in users never consult it.
 */

export interface GuestRecordPolicy {
  /** The standalone classroom page renders for an anonymous visitor. */
  readonly guest: boolean;
  /** The course's `guest_local_records` flag. */
  readonly localRecords: boolean;
}

const DEFAULT_POLICY: GuestRecordPolicy = { guest: false, localRecords: false };

let policy = DEFAULT_POLICY;

export function setGuestRecordPolicy(next: GuestRecordPolicy): void {
  policy = next;
}

export function getGuestRecordPolicy(): GuestRecordPolicy {
  return policy;
}

/** Whether this page is a guest classroom (read by the bootstrap's importer guard). */
export function isGuestClassroomPage(): boolean {
  return policy.guest;
}
