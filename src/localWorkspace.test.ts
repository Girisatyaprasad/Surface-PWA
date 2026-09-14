import { describe, expect, it } from 'vitest';
import { requireWorkspaceUid, verifyWorkspaceOwner, workspaceDatabaseName } from './localWorkspace';

describe('UID-owned local workspace boundary', () => {
  it('creates independent local namespaces for Firebase users', () => {
    expect(workspaceDatabaseName('records', 'uid-A')).not.toBe(workspaceDatabaseName('records', 'uid-B'));
    expect(workspaceDatabaseName('media', 'uid-A')).not.toBe(workspaceDatabaseName('media', 'uid-B'));
  });

  it('rejects missing, malformed, and mismatched workspace owners', () => {
    expect(() => requireWorkspaceUid('')).toThrow(/UID is required/i);
    expect(() => requireWorkspaceUid('a/b')).toThrow(/UID is required/i);
    expect(() => verifyWorkspaceOwner('uid-A', 'uid-B')).toThrow(/ownership mismatch/i);
    expect(() => verifyWorkspaceOwner('uid-A', undefined, true)).toThrow(/ownership is ambiguous/i);
    expect(verifyWorkspaceOwner('uid-A', undefined, false)).toBe('uid-A');
    expect(verifyWorkspaceOwner('uid-A', 'uid-A')).toBe('uid-A');
  });
});
