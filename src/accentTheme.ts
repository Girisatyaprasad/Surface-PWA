import type { SurfaceTier } from './entitlement';

export type SurfaceVisualTier = SurfaceTier | 'SIGNED_OUT';

export const SURFACE_PRO_BLUE = '#1A73E8';
export const SURFACE_PRO_BLUE_PRESSED = '#1967D2';
export const SURFACE_MAX_PURPLE = '#7B03C5';
export const SURFACE_NEUTRAL_ACCENT = '#6F6F6A';
export const SURFACE_CHROME_LIGHT = '#F4F3EE';
export const SURFACE_CHROME_DARK = '#000000';

export type SurfaceAccentTheme = {
  accent: string;
  accentRgb: string;
  pressedAccent: string;
  premiumAccent: string | null;
  premiumAccentRgb: string | null;
};

export function surfaceAccentTheme(tier: SurfaceVisualTier): SurfaceAccentTheme {
  if (tier === 'PRO') {
    return { accent: SURFACE_PRO_BLUE, accentRgb: '26, 115, 232', pressedAccent: SURFACE_PRO_BLUE_PRESSED, premiumAccent: null, premiumAccentRgb: null };
  }
  if (tier === 'MAX') {
    return { accent: SURFACE_PRO_BLUE, accentRgb: '26, 115, 232', pressedAccent: SURFACE_PRO_BLUE_PRESSED, premiumAccent: SURFACE_MAX_PURPLE, premiumAccentRgb: '123, 3, 197' };
  }
  return { accent: SURFACE_NEUTRAL_ACCENT, accentRgb: '111, 111, 106', pressedAccent: '#555550', premiumAccent: null, premiumAccentRgb: null };
}

export function surfaceSystemChromeColor(isDarkMode: boolean): string {
  return isDarkMode ? SURFACE_CHROME_DARK : SURFACE_CHROME_LIGHT;
}
