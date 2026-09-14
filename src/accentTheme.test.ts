import { describe, expect, it } from 'vitest';
import { SURFACE_CHROME_DARK, SURFACE_CHROME_LIGHT, SURFACE_MAX_PURPLE, SURFACE_NEUTRAL_ACCENT, SURFACE_PRO_BLUE, SURFACE_PRO_BLUE_PRESSED, surfaceAccentTheme, surfaceSystemChromeColor } from './accentTheme';

describe('Surface entitlement accent theme', () => {
  it('keeps Free monochrome with a neutral accent', () => {
    expect(surfaceAccentTheme('FREE')).toMatchObject({ accent: SURFACE_NEUTRAL_ACCENT, premiumAccent: null });
  });

  it('uses Surface blue for Pro', () => {
    expect(surfaceAccentTheme('PRO')).toMatchObject({ accent: SURFACE_PRO_BLUE, pressedAccent: SURFACE_PRO_BLUE_PRESSED, premiumAccent: null });
  });

  it('uses blue as Max primary and purple only as its premium accent', () => {
    expect(surfaceAccentTheme('MAX')).toMatchObject({ accent: SURFACE_PRO_BLUE, pressedAccent: SURFACE_PRO_BLUE_PRESSED, premiumAccent: SURFACE_MAX_PURPLE });
  });

  it('keeps signed-out screens monochrome', () => {
    expect(surfaceAccentTheme('SIGNED_OUT')).toMatchObject({ accent: SURFACE_NEUTRAL_ACCENT, premiumAccent: null });
  });

  it('switches tokens immediately when entitlement changes', () => {
    expect(surfaceAccentTheme('FREE').accent).toBe(SURFACE_NEUTRAL_ACCENT);
    expect(surfaceAccentTheme('PRO').accent).toBe(SURFACE_PRO_BLUE);
    expect(surfaceAccentTheme('MAX').accent).toBe(SURFACE_PRO_BLUE);
  });

  it('keeps system chrome independent from plan, using app surfaces in light and dark mode', () => {
    for (const tier of ['SIGNED_OUT', 'FREE', 'PRO', 'MAX'] as const) {
      surfaceAccentTheme(tier);
      expect(surfaceSystemChromeColor(false)).toBe(SURFACE_CHROME_LIGHT);
      expect(surfaceSystemChromeColor(true)).toBe(SURFACE_CHROME_DARK);
    }
  });
});
