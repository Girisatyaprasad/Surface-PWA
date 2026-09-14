import { describe, expect, it, vi } from 'vitest';
import {
  canShowInstallAction,
  isIosEnvironment,
  isStandaloneEnvironment,
  SurfaceInstallController,
  type InstallEnvironment,
} from './installController';

class TestInstallPrompt extends Event {
  prompt = vi.fn(async () => undefined);
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;

  constructor(outcome: 'accepted' | 'dismissed' = 'accepted') {
    super('beforeinstallprompt', { cancelable: true });
    this.userChoice = Promise.resolve({ outcome });
  }
}

const environment = (overrides: Partial<InstallEnvironment> = {}): InstallEnvironment => ({
  standalone: false,
  userAgent: 'Chrome',
  platform: 'Win32',
  maxTouchPoints: 0,
  ...overrides,
});

describe('Surface install controller', () => {
  it('detects installed and iOS environments without offering a browser prompt on iOS', () => {
    expect(isStandaloneEnvironment(environment({ standalone: true }))).toBe(true);
    expect(isIosEnvironment(environment({ userAgent: 'iPhone Safari' }))).toBe(true);
    expect(isIosEnvironment(environment({ platform: 'MacIntel', maxTouchPoints: 5 }))).toBe(true);

    const target = new EventTarget();
    const controller = new SurfaceInstallController(target, environment({ userAgent: 'iPhone Safari' }));
    controller.start();
    target.dispatchEvent(new TestInstallPrompt());
    expect(controller.state).toBe('ios-instructions');
    expect(canShowInstallAction(controller.state)).toBe(true);
    controller.stop();
  });

  it('captures and prevents the browser prompt, then invokes it once from the install action', async () => {
    const target = new EventTarget();
    const controller = new SurfaceInstallController(target, environment());
    controller.start();
    const event = new TestInstallPrompt('dismissed');

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(controller.state).toBe('prompt-available');
    expect(canShowInstallAction(controller.state)).toBe(true);
    await controller.install();

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(controller.state).toBe('prompt-used');
    expect(canShowInstallAction(controller.state)).toBe(false);
    await controller.install();
    expect(event.prompt).toHaveBeenCalledTimes(1);
    target.dispatchEvent(new TestInstallPrompt());
    expect(controller.state).toBe('prompt-used');
    controller.stop();
  });

  it('hides installation UI after appinstalled', () => {
    const target = new EventTarget();
    const controller = new SurfaceInstallController(target, environment({ standalone: true }));
    controller.start();
    expect(controller.state).toBe('installed');
    expect(canShowInstallAction(controller.state)).toBe(false);
    target.dispatchEvent(new Event('appinstalled'));
    expect(controller.state).toBe('installed');
    controller.stop();
  });

  it('uses a non-actionable browser fallback when no prompt is available', () => {
    const controller = new SurfaceInstallController(new EventTarget(), environment());
    expect(controller.state).toBe('unsupported');
    expect(canShowInstallAction(controller.state)).toBe(false);
  });
});
