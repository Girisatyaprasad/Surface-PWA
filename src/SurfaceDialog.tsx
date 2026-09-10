import React, { useEffect, useRef } from 'react';

type SurfaceDialogProps = {
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
  onDismiss?: () => void;
  dismissOnBackdrop?: boolean;
};

/** Shared native-style modal shell. Confirmation overlays intentionally require an explicit action. */
export function SurfaceDialog({ children, className = '', labelledBy, onDismiss, dismissOnBackdrop = false }: SurfaceDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onDismiss) {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1) : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      focusable[nextIndex].focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [onDismiss]);

  return <div className="surface-dialog-overlay" onMouseDown={(event) => { if (dismissOnBackdrop && event.target === event.currentTarget) onDismiss?.(); }}><div ref={dialogRef} className={`surface-dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>{children}</div></div>;
}
