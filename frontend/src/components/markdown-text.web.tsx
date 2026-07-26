import React from 'react';
import { Streamdown } from 'streamdown';

import { type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

/**
 * Web build: Vercel's Streamdown — markdown built for streaming. It renders
 * incomplete blocks gracefully (an unterminated **bold or half-arrived list
 * doesn't flash raw asterisks while the answer is still typing itself).
 * Native uses ./markdown-text.tsx instead.
 */
export function MarkdownText({ children }: { children: string }) {
  const { colors } = useTokens();
  return (
    <div
      style={{
        color: colors.text,
        fontSize: type.body.fontSize,
        lineHeight: 1.55,
        // The app's loaded Inter face; Streamdown's own elements (strong, ul,
        // code) inherit from here. Sans-serif fallback covers the font still
        // loading on first paint.
        fontFamily: `${type.body.fontFamily}, sans-serif`,
        overflowWrap: 'anywhere',
      }}
    >
      <Streamdown>{children}</Streamdown>
    </div>
  );
}
