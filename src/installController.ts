export type InstallState = 'installed' | 'prompt-available' | 'ios-instructions' | 'unsupported' | 'prompt-used';

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallEnvironment {
  standalone: boolean;
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

export function isIosEnvironment(environment: Pick<InstallEnvironment, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  return /iphone|ipad|ipod/i.test(environment.userAgent)
    || (environment.platform === 'MacIntel' && environment.maxTouchPoints > 1);
}

export function isStandaloneEnvironment(environment: Pick<InstallEnvironment, 'standalone'>): boolean {
  return environment.standalone;
}

export function canShowInstallAction(state: InstallState): boolean {
  return state === 'prompt-available' || state === 'ios-instructions';
}

export function readInstallEnvironment(win: Window, nav: Navigator): InstallEnvironment {
  const standalone = win.matchMedia('(display-mode: standalone)').matches
    || Boolean((nav as Navigator & { standalone?: boolean }).standalone);
  return {
    standalone,
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
  };
}

export class SurfaceInstallController {
  private current: InstallState;
  private promptEvent: InstallPromptEvent | null = null;
  private started = false;
  private prompting = false;
  private readonly listeners = new Set<(state: InstallState) => void>();

  constructor(
    private readonly target: EventTarget,
    environment: InstallEnvironment,
  ) {
    this.current = environment.standalone
      ? 'installed'
      : isIosEnvironment(environment) ? 'ios-instructions' : 'unsupported';
  }

  get state(): InstallState {
    return this.current;
  }

  subscribe(listener: (state: InstallState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.target.addEventListener('appinstalled', this.handleInstalled);
    if (this.current !== 'installed' && this.current !== 'ios-instructions') {
      this.target.addEventListener('beforeinstallprompt', this.handlePromptAvailable as EventListener);
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.target.removeEventListener('appinstalled', this.handleInstalled);
    this.target.removeEventListener('beforeinstallprompt', this.handlePromptAvailable as EventListener);
  }

  async install(): Promise<void> {
    if (this.current !== 'prompt-available' || !this.promptEvent || this.prompting) return;
    this.prompting = true;
    const prompt = this.promptEvent;
    try {
      await prompt.prompt();
      await prompt.userChoice;
      this.promptEvent = null;
      this.setStateUnlessInstalled('prompt-used');
    } catch {
      this.promptEvent = null;
      this.setStateUnlessInstalled('unsupported');
    } finally {
      this.prompting = false;
    }
  }

  private readonly handlePromptAvailable = (event: Event): void => {
    event.preventDefault();
    if (this.current === 'installed' || this.current === 'ios-instructions' || this.current === 'prompt-used') return;
    this.promptEvent = event as InstallPromptEvent;
    this.setState('prompt-available');
  };

  private readonly handleInstalled = (): void => {
    this.promptEvent = null;
    this.setState('installed');
  };

  private setState(state: InstallState): void {
    if (this.current === state) return;
    this.current = state;
    this.listeners.forEach((listener) => listener(state));
  }

  private setStateUnlessInstalled(state: Exclude<InstallState, 'installed'>): void {
    if (this.current !== 'installed') this.setState(state);
  }
}
