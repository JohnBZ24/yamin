const expoConfig = require('eslint-config-expo/flat');
const { defineConfig } = require('eslint/config');

/**
 * The rule that keeps the design system honest.
 *
 * The palette lives in src/theme/tokens.ts and components read it through
 * useTokens(). Nothing enforced that. The build this replaced had ~25 inline
 * hexes and six near-identical off-white pinks (#FFF8F8, #FFF5F5, #FFF1F2 …) —
 * the signature of picking a colour by eye each time one was needed instead of
 * pulling from a scale. It also had a theme file nothing imported, which is why
 * dark mode silently did nothing.
 *
 * Components are clean today. This is what stops them drifting back one
 * convenient hex at a time, because that drift never arrives as a decision —
 * it arrives as a hurry.
 *
 * Scoped to src/app and src/components, so the two places a raw colour is
 * legitimate stay legal without an exemption comment: src/theme/tokens.ts (the
 * source of truth itself) and src/lib/push.ts (an Android notification-channel
 * LED colour, which is a platform API argument, not a style).
 */
const RAW_COLOUR_MESSAGE =
  'Raw colour value. Use a semantic token from useTokens() — see src/theme/tokens.ts. ' +
  'If this genuinely cannot be a token, add the colour to tokens.ts rather than inlining it here.';

// Three hex chars is enough to identify a colour and short enough to catch
// shorthand (#fff). It will not fire on '#app'-style strings, since a run of
// three consecutive hex digits is required.
const HEX_COLOUR = String.raw`#[0-9a-fA-F]{3}`;
const FUNCTIONAL_COLOUR = String.raw`\b(?:rgba?|hsla?)\s*\(`;

module.exports = defineConfig([
  expoConfig,

  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'expo-env.d.ts'],
  },

  /**
   * Advisory, not blocking. These are eslint-plugin-react-hooks v6's new
   * React-Compiler-era rules, and they fire on patterns here that are
   * deliberate and documented:
   *
   *  - `immutability` flags `sharedValue.value = x`, which is precisely how
   *    Reanimated shared values are written. The rule does not model Reanimated,
   *    so every hit is a false positive.
   *  - `refs` flags the `live.current` re-pointing in composer.tsx. That
   *    indirection is load-bearing: PanResponder handlers are built once
   *    (rebuilding mid-gesture drops the touch) and must still see fresh
   *    callbacks, which the comment there explains at length.
   *  - `set-state-in-effect` flags resetting state when its input clears
   *    (realtime.tsx on sign-out, graph.tsx on deselect) and a web hydration
   *    flag. Real advice in general, not a defect in these three.
   *
   * Left visible as warnings rather than switched off, so the signal survives
   * for anyone who wants to revisit it — but they don't fail `npm run lint`,
   * because a lint suite that is red on arrival gets ignored wholesale, and it
   * would take the rule below down with it.
   */
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  {
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/${HEX_COLOUR}/]`,
          message: RAW_COLOUR_MESSAGE,
        },
        {
          selector: `Literal[value=/${FUNCTIONAL_COLOUR}/]`,
          message: RAW_COLOUR_MESSAGE,
        },
        // Template literals are a separate node type, so the two selectors
        // above cannot see them: `${base}#fff` would otherwise slip through.
        {
          selector: `TemplateElement[value.raw=/${HEX_COLOUR}/]`,
          message: RAW_COLOUR_MESSAGE,
        },
        {
          selector: `TemplateElement[value.raw=/${FUNCTIONAL_COLOUR}/]`,
          message: RAW_COLOUR_MESSAGE,
        },
      ],
    },
  },
]);
