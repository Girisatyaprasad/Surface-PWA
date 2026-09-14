export type WorkspaceDatabaseKind = 'records' | 'media';

export function requireWorkspaceUid(uid: string): string {
  if (typeof uid !== 'string' || uid.trim() === '' || uid.includes('/')) {
    throw new Error('A valid authenticated Firebase UID is required for local workspace access.');
  }
  return uid;
}

export function workspaceDatabaseName(kind: WorkspaceDatabaseKind, uid: string): string {
  const ownerUid = requireWorkspaceUid(uid);
  const encodedUid = encodeURIComponent(ownerUid);
  return kind === 'records' ? `surface-pwa-user-${encodedUid}` : `surface-pwa-media-user-${encodedUid}`;
}

export function verifyWorkspaceOwner(expectedUid: string, storedUid: string | undefined, containsData = false): string {
  const expected = requireWorkspaceUid(expectedUid);
  if (storedUid !== undefined && storedUid !== expected) {
    throw new Error('Local workspace ownership mismatch. Access was denied.');
  }
  if (storedUid === undefined && containsData) {
    throw new Error('Local workspace ownership is ambiguous. Access was denied.');
  }
  return expected;
}
