/**
 * `use no memo` — opt this file out of the React Compiler.
 *
 * `experiments.reactCompiler` is on in app.json. These are not React Native
 * components: TextWidget literally returns null, and the library walks the
 * returned element tree itself to build Android RemoteViews. Compiler-inserted
 * memoisation caches against React's renderer internals, which are not driving
 * this tree — at best it is dead weight, at worst it breaks the walk or trips an
 * invalid-hook-call outside a render. Cheap directive, removes a whole class of
 * confusing failure.
 */
'use no memo';

import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

import { palettes, radius, space, type Palette } from '../theme/tokens';

/**
 * What the widget needs to draw itself. Deliberately not the `Reminder` type
 * from lib/api: the widget also has to render when there is no session and no
 * network, so "no reminder" and "signed out" are states here, not error paths.
 */
export type NextReminderState =
  | { kind: 'reminder'; title: string; scheduledFor: string }
  | { kind: 'empty' }
  | { kind: 'signedOut' }
  | { kind: 'offline' };

export type NextReminderWidgetProps = {
  state: NextReminderState;
  colors: Palette;
  /**
   * Passed in rather than read inside, so the light and dark variants below
   * cannot disagree by a millisecond, and so `describeWhen` stays pure.
   */
  now: Date;
};

/**
 * Only hex is allowed by the widget primitives (`HexColor`), and a few tokens —
 * `overlay`, `onBrandSubtle`, `onBrandMuted` — are rgba(). None of those are
 * used below; this narrows the rest for the type checker without a cast at every
 * call site.
 */
const hex = (value: string) => value as `#${string}`;

/**
 * "in 20m", "in 3h", "tomorrow 09:00", "Tue 14:30".
 *
 * A wall-clock time alone is not much use on a home screen — "14:30" could be
 * four days away. The relative form is what makes the widget answer "is this
 * about to happen?" at a glance, and it falls back to an absolute date once
 * "in N days" stops being meaningful.
 */
export function describeWhen(scheduledFor: string, now: Date = new Date()): string {
  const at = new Date(scheduledFor);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const diffMs = at.getTime() - now.getTime();

  if (Number.isNaN(diffMs)) return '';
  // Already due but not yet delivered — the worker fires within a minute, and
  // "in -2m" would be nonsense.
  if (diffMs <= 0) return 'now';

  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `in ${minutes}m`;

  const hours = Math.round(minutes / 60);
  if (hours < 12) return `in ${hours}h`;

  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const daysAhead = Math.floor((at.getTime() - midnight.getTime()) / 86_400_000) + 1;

  if (daysAhead <= 0) return time;
  if (daysAhead === 1) return `tomorrow ${time}`;
  if (daysAhead < 7) {
    return `${at.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  }
  return at.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** The label above the body, per state. */
function headingFor(state: NextReminderState): string {
  switch (state.kind) {
    case 'reminder':
      return 'NEXT UP';
    case 'empty':
      return 'YAMIN';
    case 'signedOut':
      return 'YAMIN';
    case 'offline':
      return 'YAMIN';
  }
}

function bodyFor(state: NextReminderState): string {
  switch (state.kind) {
    case 'reminder':
      return state.title;
    case 'empty':
      return 'Nothing scheduled';
    case 'signedOut':
      return 'Tap to sign in';
    case 'offline':
      return 'Tap to open';
  }
}

/**
 * The whole widget is one tap target opening the app — there is no second
 * action, so making only part of it clickable would just create dead zones on
 * something already the size of a stamp. OPEN_APP is a reserved action handled
 * natively, so it works with the app killed and needs no deep-link wiring.
 */
export function NextReminderWidget({
  state,
  colors,
  now,
}: NextReminderWidgetProps) {
  const when =
    state.kind === 'reminder' ? describeWhen(state.scheduledFor, now) : null;

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={
        state.kind === 'reminder'
          ? `Next reminder: ${state.title}, ${when}. Open Yamin.`
          : 'Open Yamin'
      }
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'space-between',
        // `surface` (gray2) rather than `canvas` (gray1): the widget is a card
        // sitting on the user's wallpaper, which is the role `surface` plays in
        // the app too.
        backgroundColor: hex(colors.surface),
        borderWidth: 1,
        borderColor: hex(colors.borderSubtle),
        borderRadius: radius.lg,
        padding: space.lg,
      }}
    >
      <TextWidget
        text={headingFor(state)}
        style={{
          fontSize: 10,
          fontFamily: 'Inter_500Medium',
          letterSpacing: 0.8,
          color: hex(colors.textSubtle),
        }}
      />

      <TextWidget
        text={bodyFor(state)}
        maxLines={2}
        truncate="END"
        style={{
          fontSize: 15,
          fontFamily: 'Sora_600SemiBold',
          color: hex(colors.text),
        }}
      />

      {when ? (
        <TextWidget
          text={when}
          style={{
            fontSize: 12,
            fontFamily: 'Inter_500Medium',
            color: hex(colors.textMuted),
          }}
        />
      ) : (
        // An empty spacer rather than nothing: `justifyContent: space-between`
        // needs three children to keep the heading pinned to the top and the
        // body from drifting into the middle.
        <FlexWidget style={{ height: 0, width: 0 }} />
      )}
    </FlexWidget>
  );
}

/**
 * Both palettes, for the OS to choose between.
 *
 * `renderWidget` accepts `{ light, dark }` and Android inflates whichever
 * matches the system theme. That is strictly better than picking one here from
 * `Appearance.getColorScheme()`: the widget follows a theme change immediately,
 * rather than staying wrong until the next refresh — which, given Android's
 * 30-minute floor on periodic updates, could be half an hour of the wrong
 * colours.
 */
export function renderNextReminder(state: NextReminderState) {
  const now = new Date();
  return {
    light: (
      <NextReminderWidget state={state} colors={palettes.light} now={now} />
    ),
    dark: <NextReminderWidget state={state} colors={palettes.dark} now={now} />,
  };
}
