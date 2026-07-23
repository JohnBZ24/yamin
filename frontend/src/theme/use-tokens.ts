import { useColorScheme } from '../hooks/use-color-scheme';
import { ColorScheme, Palette, palettes } from './tokens';

/**
 * The app's colours for the current system theme.
 *
 * Every component reads colour through this hook, which is what makes dark
 * mode work at all: the previous UI hardcoded light hexes inline, so the
 * existing `useColorScheme` had nothing to switch.
 */
export function useTokens(): { colors: Palette; scheme: ColorScheme } {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { colors: palettes[scheme], scheme };
}
