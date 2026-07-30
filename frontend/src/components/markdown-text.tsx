import React from 'react';
import Markdown from 'react-native-markdown-display';

import { font, type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

/**
 * Native build: renders the assistant's Markdown answers (bold names, bullet
 * lists) instead of showing raw asterisks. The web build swaps this file for
 * markdown-text.web.tsx, which uses Vercel's Streamdown — a renderer built
 * for text that is still streaming in.
 *
 * This import is why `punycode` is a direct dependency in package.json — do
 * not prune it as unused. react-native-markdown-display pulls in markdown-it,
 * which does `require('punycode')` expecting the Node builtin. Metro doesn't
 * ship Node builtins, so the Android bundle failed to resolve it and the whole
 * EAS build died; the npm package is the userland shim that satisfies it.
 * Nothing caught this before the first APK attempt because web never bundles
 * markdown-it at all — it takes the Streamdown file instead.
 */
export function MarkdownText({ children }: { children: string }) {
  const { colors } = useTokens();
  return (
    <Markdown
      style={{
        body: { ...type.body, color: colors.text },
        strong: { fontFamily: font.bodyBold },
        em: { fontStyle: 'italic' },
        bullet_list: { marginTop: 2 },
        list_item: { marginBottom: 2 },
        code_inline: {
          ...type.mono,
          color: colors.text,
          backgroundColor: colors.surfaceSunken,
        },
        /*
         * These four overrides are load-bearing, not cosmetic. The library's
         * default paragraph style is:
         *
         *   { flexWrap: 'wrap', flexDirection: 'row', width: '100%', … }
         *
         * `width: '100%'` is a PERCENTAGE, and a percentage resolves only
         * against a parent with a definite width. The answer bubble is sized by
         * its content up to a pixel maxWidth, so there is no definite width to
         * resolve against — Yoga falls back to min-content, and a row that is
         * min-content wide with flexWrap on breaks the answer one word per
         * line, stacked downwards.
         *
         * `alignSelf: 'stretch'` fills the bubble's resolved width without
         * asking a percentage to resolve, and a column direction lets the Text
         * wrap on its own the way text is supposed to.
         */
        paragraph: {
          marginTop: 0,
          marginBottom: 6,
          width: 'auto',
          alignSelf: 'stretch',
          flexDirection: 'column',
          flexWrap: 'nowrap',
        },
        // Same percentage trap, same fix.
        hardbreak: { width: 'auto', height: 1 },
      }}
    >
      {children}
    </Markdown>
  );
}
