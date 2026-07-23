import { Slot } from 'expo-router';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Sora_600SemiBold, Sora_700Bold } from '@expo-google-fonts/sora';

import { ToastProvider } from '../components/toast';
import { useTokens } from '../theme/use-tokens';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { colors, scheme } = useTokens();

  // The keys here MUST match theme/tokens.ts `font`, or every fontFamily
  // silently falls back to the system face and the design collapses.
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Sora_600SemiBold,
    Sora_700Bold,
  });

  useEffect(() => {
    // Hide on `error` too — a font that fails to load must not leave the user
    // staring at a splash screen forever.
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  // Native: hold the splash until fonts are ready, so text never swaps faces
  // in front of the user.
  //
  // Web: render immediately. Static rendering runs with fonts unloaded, so
  // returning null here pre-renders an EMPTY page — verified in the export: the
  // shipped index.html contained no markup at all. Visitors would stare at a
  // blank canvas until the 2.8MB bundle booted, and crawlers would see nothing.
  // The browser paints text in a fallback face for a moment instead, which is a
  // far better trade for a public site.
  if (!loaded && !error && Platform.OS !== 'web') {
    return null;
  }

  return (
    <ToastProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Slot />
      </View>
    </ToastProvider>
  );
}
