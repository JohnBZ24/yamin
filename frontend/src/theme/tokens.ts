import {
  amber,
  amberDark,
  grass,
  grassDark,
  gray,
  grayDark,
  tomato,
  tomatoDark,
} from '@radix-ui/colors';

/**
 * Yamin's design system.
 *
 * Built on Radix Colors, whose 12-step scales are designed so each step has a
 * fixed job (1–2 backgrounds, 3–5 component fills, 6–8 borders, 9–10 solid
 * fills, 11–12 text). The light and dark scales are perceptually matched, so
 * one set of semantic names below yields a correct app in both themes.
 *
 * Components import from here and never write a hex literal. The old UI had
 * ~25 inline hexes and a `theme.ts` nothing imported, which is why dark mode
 * silently did nothing.
 *
 * Palette: monochrome. Pure gray for every surface and border, and the brand
 * fill is simply ink — near-black on light, near-white on dark — so the one
 * accent in the app is contrast itself. Color appears only as status
 * (grass/amber/tomato), where meaning genuinely needs hue.
 */

export type ColorScheme = 'light' | 'dark';

const build = (scheme: ColorScheme) => {
  const isDark = scheme === 'dark';
  const n = isDark ? grayDark : gray;
  const ok = isDark ? grassDark : grass;
  const warn = isDark ? amberDark : amber;
  const bad = isDark ? tomatoDark : tomato;

  return {
    /** App background — the furthest-back surface. */
    canvas: n.gray1,
    /** Cards, bubbles, panels sitting on the canvas. */
    surface: n.gray2,
    /** Inputs and pressable fills. */
    surfaceSunken: n.gray3,
    surfaceHover: n.gray4,
    surfaceActive: n.gray5,

    borderSubtle: n.gray6,
    border: n.gray7,
    borderStrong: n.gray8,

    /** Body text. Step 12 is the high-contrast pairing for these backgrounds. */
    text: n.gray12,
    /** Secondary text — still accessible, deliberately quieter. */
    textMuted: n.gray11,
    /** Labels and metadata. */
    textSubtle: n.gray10,

    brandSurface: n.gray3,
    brandBorder: n.gray7,
    /**
     * The solid brand fill: ink. Step 12 is the highest-contrast step of the
     * scale, which is the entire monochrome identity — buttons are black on
     * light and white on dark.
     */
    brand: n.gray12,
    brandHover: isDark ? '#ffffff' : '#000000',
    /** Brand-coloured text on a neutral background — in mono, just ink. */
    brandText: n.gray12,
    /** Text on top of `brand` — the opposite pole of the scale. */
    onBrand: isDark ? '#0b0b0b' : '#ffffff',

    successSurface: ok.grass3,
    successText: ok.grass11,
    warningSurface: warn.amber3,
    warningText: warn.amber11,
    dangerSurface: bad.tomato3,
    dangerText: bad.tomato11,
    danger: bad.tomato9,

    overlay: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)',
    /**
     * Fills on top of the brand colour (e.g. controls inside a brand bubble).
     * Brand is black in light mode and white in dark mode, so these overlays
     * flip with it.
     */
    onBrandSubtle: isDark ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.18)',
    onBrandMuted: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.65)',
  };
};

export const palettes: Record<ColorScheme, ReturnType<typeof build>> = {
  light: build('light'),
  dark: build('dark'),
};

export type Palette = ReturnType<typeof build>;

/** 4px base scale — every gap and pad is a multiple, so rhythm stays consistent. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * Sora for the brand/display voice, Inter for everything else — Inter is
 * designed for UI at small sizes, which is most of this app.
 *
 * These names must match the keys passed to useFonts() in _layout.tsx, or the
 * platform silently falls back to a system font and the app looks like the
 * `FONT_FAMILY = 'Arial'` version it replaced.
 */
export const font = {
  display: 'Sora_600SemiBold',
  displayBold: 'Sora_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
} as const;

export const type = {
  display: { fontFamily: font.displayBold, fontSize: 34, letterSpacing: -0.8 },
  title: { fontFamily: font.display, fontSize: 20, letterSpacing: -0.3 },
  heading: { fontFamily: font.bodySemi, fontSize: 16, letterSpacing: -0.2 },
  body: { fontFamily: font.body, fontSize: 15, lineHeight: 22 },
  bodyMedium: { fontFamily: font.bodyMedium, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  smallMedium: { fontFamily: font.bodyMedium, fontSize: 13, lineHeight: 18 },
  /** Uppercase micro-labels. Tracking is widened because caps need the air. */
  label: {
    fontFamily: font.bodySemi,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
  },
  mono: { fontFamily: font.body, fontSize: 12 },
} as const;

/** Single source of truth for the responsive switch. */
export const BREAKPOINT_DESKTOP = 900;
