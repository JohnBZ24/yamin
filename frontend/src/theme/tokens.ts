import {
  amber,
  amberDark,
  grass,
  grassDark,
  iris,
  irisDark,
  mauve,
  mauveDark,
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
 * Palette: iris (brand — keeps the violet identity), mauve (neutral, tuned to
 * sit under iris), plus grass/amber/tomato for status only.
 */

export type ColorScheme = 'light' | 'dark';

const build = (scheme: ColorScheme) => {
  const isDark = scheme === 'dark';
  const n = isDark ? mauveDark : mauve;
  const b = isDark ? irisDark : iris;
  const ok = isDark ? grassDark : grass;
  const warn = isDark ? amberDark : amber;
  const bad = isDark ? tomatoDark : tomato;

  return {
    /** App background — the furthest-back surface. */
    canvas: n.mauve1,
    /** Cards, bubbles, panels sitting on the canvas. */
    surface: n.mauve2,
    /** Inputs and pressable fills. */
    surfaceSunken: n.mauve3,
    surfaceHover: n.mauve4,
    surfaceActive: n.mauve5,

    borderSubtle: n.mauve6,
    border: n.mauve7,
    borderStrong: n.mauve8,

    /** Body text. Step 12 is the high-contrast pairing for these backgrounds. */
    text: n.mauve12,
    /** Secondary text — still accessible, deliberately quieter. */
    textMuted: n.mauve11,
    /** Labels and metadata. */
    textSubtle: n.mauve10,

    brandSurface: b.iris3,
    brandBorder: b.iris6,
    /** The solid brand fill. Step 9 is the most saturated step. */
    brand: b.iris9,
    brandHover: b.iris10,
    /** Brand-coloured text on a neutral background. */
    brandText: b.iris11,
    /** Text on top of `brand`. White is the accessible pairing for step 9. */
    onBrand: '#ffffff',

    successSurface: ok.grass3,
    successText: ok.grass11,
    warningSurface: warn.amber3,
    warningText: warn.amber11,
    dangerSurface: bad.tomato3,
    dangerText: bad.tomato11,
    danger: bad.tomato9,

    overlay: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)',
    /** Fills on top of the brand colour (e.g. controls inside a brand bubble). */
    onBrandSubtle: 'rgba(255,255,255,0.18)',
    onBrandMuted: 'rgba(255,255,255,0.65)',
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
