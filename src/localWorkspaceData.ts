import { deleteLocalRecordsWorkspace } from './db';
import { deleteLocalMediaWorkspace } from './media';
import { requireWorkspaceUid } from './localWorkspace';

export async function eraseLocalWorkspace(uid: string): Promise<void> {
  const ownerUid = requireWorkspaceUid(uid);
  await Promise.all([deleteLocalRecordsWorkspace(ownerUid), deleteLocalMediaWorkspace(ownerUid)]);
}
