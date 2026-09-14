import { useEffect, useState } from 'react';
import {
  canShowInstallAction,
  readInstallEnvironment,
  SurfaceInstallController,
  type InstallState,
} from './installController';

export function InstallSurface() {
  const [controller] = useState(() => new SurfaceInstallController(window, readInstallEnvironment(window, navigator)));
  const [state, setState] = useState<InstallState>(controller.state);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    controller.start();
    return () => {
      unsubscribe();
      controller.stop();
    };
  }, [controller]);

  if (state === 'installed' || state === 'prompt-used') return null;

  return <div className="install-surface">
    {canShowInstallAction(state) ? <button
      type="button"
      className="surface-action"
      onClick={() => state === 'ios-instructions' ? setShowInstructions(true) : void controller.install()}
    >Install Surface</button> : <p className="install-hint">Use your browser&apos;s Add to Home Screen / Install app option.</p>}

    {showInstructions && state === 'ios-instructions' && <div className="install-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setShowInstructions(false);
    }}>
      <section className="install-guide" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <div className="install-guide-heading"><img src="/surface-logo.svg" alt="" /><strong id="install-title">Install Surface</strong></div>
        <ol>
          <li>Tap Share</li>
          <li>Choose <b>Add to Home Screen</b></li>
          <li>Enable <b>Open as Web App</b> if shown</li>
          <li>Tap <b>Add</b></li>
        </ol>
        <p className="install-secondary-help">If Add to Home Screen is hidden, check Edit Actions.</p>
        <button type="button" className="text-button" onClick={() => setShowInstructions(false)}>Done</button>
      </section>
    </div>}
  </div>;
}
