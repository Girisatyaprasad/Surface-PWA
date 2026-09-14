import { SurfaceDialog } from './SurfaceDialog';

export type LegacyRecoveryDialogMode = 'prompt' | 'confirm' | 'moving' | 'error';

export function LegacyRecoveryDialog({ mode, email, onLeave, onContinue, onCancel, onMove, onRetry }: {
  mode: LegacyRecoveryDialogMode | null;
  email: string;
  onLeave: () => void;
  onContinue: () => void;
  onCancel: () => void;
  onMove: () => void;
  onRetry: () => void;
}) {
  if (!mode) return null;
  if (mode === 'prompt') return <SurfaceDialog className="legacy-recovery-dialog" labelledBy="legacy-recovery-title">
    <h3 id="legacy-recovery-title">Old Surface data found</h3>
    <p>Surface found data on this device that was created before account-separated local storage was introduced.</p>
    <p>If this data belongs to you, you can move it into your current Surface account.</p>
    <div className="surface-dialog-actions"><button className="surface-dialog-action" onClick={onContinue}>Move to my account</button><button className="surface-dialog-cancel" onClick={onLeave}>Leave it untouched</button></div>
  </SurfaceDialog>;
  if (mode === 'confirm') return <SurfaceDialog className="legacy-recovery-dialog" labelledBy="legacy-recovery-confirm-title">
    <h3 id="legacy-recovery-confirm-title">Confirm data move</h3>
    <p>Only continue if this old Surface data belongs to you.</p>
    <p>It will be moved into the Surface workspace for:</p>
    <strong className="legacy-recovery-email">{email || 'the signed-in account'}</strong>
    <p>Older Surface versions did not store account ownership, so Surface cannot verify who originally created this data.</p>
    <div className="surface-dialog-actions"><button className="surface-dialog-cancel" onClick={onCancel}>Cancel</button><button className="surface-dialog-action" onClick={onMove}>Move data</button></div>
  </SurfaceDialog>;
  if (mode === 'moving') return <SurfaceDialog className="legacy-recovery-dialog" labelledBy="legacy-recovery-moving-title"><h3 id="legacy-recovery-moving-title">Moving old Surface data</h3><p>Keep Surface open while your local data is copied and checked.</p><div className="legacy-recovery-progress" role="status">Moving and verifying…</div></SurfaceDialog>;
  return <SurfaceDialog className="legacy-recovery-dialog" labelledBy="legacy-recovery-error-title">
    <h3 id="legacy-recovery-error-title">Data was not moved</h3>
    <p>Surface couldn't move your old local data. Your original data has been left untouched.</p>
    <div className="surface-dialog-actions"><button className="surface-dialog-cancel" onClick={onCancel}>Close</button><button className="surface-dialog-action" onClick={onRetry}>Try again</button></div>
  </SurfaceDialog>;
}
