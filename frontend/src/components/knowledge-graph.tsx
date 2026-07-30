import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  Simulation,
  SimulationLinkDatum,
  SimulationNodeDatum,
} from 'd3-force';

import { useGraph } from '../lib/queries';
import { font, space, type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

type SimNode = SimulationNodeDatum & {
  id: number;
  name: string;
  entityType: string;
  mentionCount: number;
};

type SimLink = SimulationLinkDatum<SimNode> & {
  relationType: string;
  description: string | null;
  mentionCount: number;
};

/** Node radius grows with salience, gently — sqrt keeps outliers in check. */
const radiusOf = (n: SimNode) =>
  Math.min(26, 9 + Math.sqrt(Math.max(0, n.mentionCount)) * 3);

/**
 * Press handling for SVG elements, per platform. `onPress` on web makes
 * react-native-svg attach RN responder props (onResponderTerminate & co.)
 * to real DOM nodes, which React warns about on every render; the DOM's own
 * onClick is the warning-free equivalent there.
 */
const pressProps = (handler: () => void) =>
  Platform.OS === 'web'
    ? ({ onClick: handler } as Record<string, unknown>)
    : { onPress: handler };

const PAD = 44;
/**
 * Below this the layout has visually settled — running on past it only shivers.
 * Raised from 0.015: the last stretch moves nodes by fractions of a pixel that
 * nobody can see, and every one of those ticks is time the UI is frozen.
 */
const REST_ALPHA = 0.04;
/**
 * Ceiling on ticks per solve, so a pathological graph can't hang the thread.
 *
 * Each tick is O(n log n) for the charge force and runs synchronously on the JS
 * thread, so this number is a freeze budget, not a quality dial. In practice
 * REST_ALPHA ends the loop well before this.
 */
const MAX_TICKS = 150;
/**
 * Hard cap on rendered nodes, most-mentioned first.
 *
 * Cost is superlinear in both the solve and the SVG render, and a phone showing
 * 300 unreadable overlapping circles is worse than one showing the 60 that
 * matter. Without a ceiling the graph gets slower every week the app is used.
 */
const MAX_NODES = 60;

/** Drag has to travel this far before the pan claims the touch, so taps still land on nodes. */
const PAN_SLOP = 4;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;

/**
 * How far past its own edge the graph may be dragged, so a pan at the boundary
 * still feels alive rather than nailed down.
 */
const PAN_OVERSCROLL = 48;

/**
 * The furthest the graph may be translated on one axis before it would leave
 * empty space in the viewport.
 *
 * The simulation already clamps every node into [PAD, extent - PAD], so at
 * zoom 1 the content is exactly viewport-sized and the honest pan range is zero.
 * Zooming in makes it larger than the viewport by `extent * (z - 1)`, half of
 * which is available in each direction.
 *
 * Without this the graph could be dragged arbitrarily far into blank space and
 * simply lost — nothing pulled it back, and there is no "reset view" control to
 * recover with.
 */
function panLimit(extent: number, z: number): number {
  return Math.max(0, (extent * (z - 1)) / 2) + PAN_OVERSCROLL;
}

const clamp = (value: number, limit: number) =>
  Math.min(limit, Math.max(-limit, value));

/**
 * One edge. Memoised on primitives only.
 *
 * The whole SVG used to re-render on every tap: selecting a node changed
 * `selectedId`, which re-created ~60 node groups of three elements each plus
 * every edge and label. On Android react-native-svg maps each of those to a
 * real view, so a tap meant rebuilding a few hundred views before the highlight
 * appeared — which is exactly what "laggy when I touch it" was.
 *
 * Splitting them out means a tap re-renders only the handful whose `lit`/`dim`
 * actually changed. Every prop here is a string or number so the default
 * shallow compare is enough.
 */
const GraphEdge = React.memo(function GraphEdge({
  x1,
  y1,
  x2,
  y2,
  stroke,
  strokeWidth,
  strokeOpacity,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
}) {
  return (
    <Line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeOpacity={strokeOpacity}
    />
  );
});

/** One node: circle, initials, and its label underneath. Memoised like the edges. */
const GraphNodeView = React.memo(function GraphNodeView({
  id,
  x,
  y,
  r,
  label,
  short,
  selected,
  dimmed,
  fill,
  stroke,
  labelColour,
  initialsColour,
  onPress,
}: {
  id: number;
  x: number;
  y: number;
  r: number;
  label: string;
  short: string;
  selected: boolean;
  dimmed: boolean;
  fill: string;
  stroke: string;
  labelColour: string;
  initialsColour: string;
  onPress: (id: number) => void;
}) {
  const press = useCallback(() => onPress(id), [onPress, id]);

  return (
    <G opacity={dimmed ? 0.25 : 1}>
      <Circle
        cx={x}
        cy={y}
        r={r}
        fill={fill}
        stroke={stroke}
        strokeWidth={selected ? 2 : 1.5}
        {...pressProps(press)}
      />
      <SvgText
        x={x}
        y={y + 4}
        fontSize={r >= 14 ? 11 : 9}
        fontFamily={font.bodySemi}
        fill={initialsColour}
        textAnchor="middle"
        {...pressProps(press)}
      >
        {short}
      </SvgText>
      <SvgText
        x={x}
        y={y + r + 14}
        fontSize={10}
        fontFamily={font.body}
        fill={labelColour}
        textAnchor="middle"
      >
        {label}
      </SvgText>
    </G>
  );
});

/**
 * The knowledge graph, laid out by a force simulation that is SOLVED rather
 * than animated.
 *
 * It used to drive d3 from requestAnimationFrame and bump a counter every tick,
 * which re-rendered the entire SVG — every node, its two labels, and every edge
 * — sixty times a second. On a phone that is hundreds of re-renders per
 * interaction and the graph was visibly unusable. Worse, tapping a node changed
 * the container height, which rebuilt the simulation from scratch.
 *
 * So the simulation runs to rest inside one synchronous pass and the result is
 * painted exactly once — no frame loop at all.
 *
 * Tapping used to reheat and re-solve. It no longer does anything but change
 * which nodes are highlighted, because that re-solve was still 140 ticks of
 * n-body physics blocking the JS thread on every tap, and it also rearranged
 * the whole map each time — so the positions you had just learned kept moving.
 * A tap is now a Set lookup. The layout is computed once and holds still.
 *
 * Pan and pinch move the graph by transforming ONE wrapper view on the UI
 * thread. Nothing re-renders while you drag: React never sees the gesture, so
 * dragging stays smooth no matter how many nodes are on screen.
 */
export function KnowledgeGraph({
  token,
  width,
  height,
  onSelect,
  selectedId,
}: {
  token: string;
  width: number;
  height: number;
  onSelect: (id: number | null) => void;
  selectedId: number | null;
}) {
  const { colors } = useTokens();
  // Invalidated whenever a note finishes processing, so the map reflects what
  // Yamin learned without this screen having to be told.
  const { data, error } = useGraph(token);

  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  /**
   * The solved layout. d3 mutates its node objects in place, so what is stored
   * is a SNAPSHOT of the positions — publishing the mutable array would let a
   * later solve silently change what React already painted.
   */
  const [layout, setLayout] = useState<{
    nodes: SimNode[];
    links: SimLink[];
  }>({ nodes: [], links: [] });

  /**
   * Pan/zoom state, on the UI thread.
   *
   * Shared values rather than React state: a drag writes these sixty times a
   * second, and routing that through setState would re-render the entire SVG on
   * every touch move — the thing this component exists to avoid.
   */
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const zoom = useSharedValue(1);

  // Where the gesture started, so movement is applied as a delta.
  const start = useRef({ x: 0, y: 0, zoom: 1, distance: 0 });

  /**
   * Viewport size for the pan clamp, read from a ref rather than closed over:
   * the PanResponder below is built once (its deps are `[]`, because rebuilding
   * it mid-gesture would drop the gesture), so a captured `width` would be the
   * value from first render forever — and wrong after a rotation.
   */
  const sizeRef = useRef({ width, height });
  useEffect(() => {
    sizeRef.current = { width, height };
  }, [width, height]);

  const viewStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: zoom.value },
    ],
  }));

  const pan = useMemo(
    () =>
      PanResponder.create({
        /**
         * Never claim the touch on press — that would swallow taps meant for a
         * node. The pan only takes over once the finger has actually travelled,
         * so tap-to-select and drag-to-pan coexist on the same surface.
         */
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > PAN_SLOP || Math.abs(g.dy) > PAN_SLOP,

        onPanResponderGrant: (e) => {
          const touches = e.nativeEvent.touches;
          start.current = {
            x: tx.value,
            y: ty.value,
            zoom: zoom.value,
            distance: touches.length >= 2 ? touchDistance(touches) : 0,
          };
        },

        onPanResponderMove: (e, g) => {
          const touches = e.nativeEvent.touches;

          // Two fingers: pinch. Scale relative to the distance at grant, so the
          // graph does not jump when the second finger lands.
          if (touches.length >= 2) {
            const distance = touchDistance(touches);
            if (start.current.distance > 0 && distance > 0) {
              const next = start.current.zoom * (distance / start.current.distance);
              zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));

              // Zooming OUT shrinks the legal pan range, so a translation that
              // was in bounds a moment ago may no longer be. Re-clamping here is
              // what stops a pinch-out from stranding the graph off-screen.
              const { width: w, height: h } = sizeRef.current;
              tx.value = clamp(tx.value, panLimit(w, zoom.value));
              ty.value = clamp(ty.value, panLimit(h, zoom.value));
            }
            return;
          }

          const { width: w, height: h } = sizeRef.current;
          tx.value = clamp(start.current.x + g.dx, panLimit(w, zoom.value));
          ty.value = clamp(start.current.y + g.dy, panLimit(h, zoom.value));
        },

        // A second finger lifting mid-pinch leaves a stale baseline; re-seed it
        // from wherever the gesture is now.
        onPanResponderEnd: () => {
          start.current = {
            x: tx.value,
            y: ty.value,
            zoom: zoom.value,
            distance: 0,
          };
        },
      }),
    // Built once. Shared values are stable refs, so nothing here goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Run the simulation to rest and publish the result. One pass, one render.
   *
   * Clamping happens per tick rather than once at the end: the charge force
   * happily flings a loosely-connected node off a small viewport, and letting
   * it travel out there for 400 ticks before yanking it back distorts
   * everything it pushed against on the way.
   */
  const solve = useCallback(
    (ticks: number) => {
      const sim = simRef.current;
      if (!sim) return;

      for (let i = 0; i < ticks; i += 1) {
        sim.tick();
        for (const n of sim.nodes()) {
          n.x = Math.min(width - PAD, Math.max(PAD, n.x ?? 0));
          n.y = Math.min(height - PAD, Math.max(PAD, n.y ?? 0));
        }
        if (sim.alpha() <= REST_ALPHA) break;
      }

      // Snapshot: d3 keeps mutating the objects it owns, and a rendered frame
      // must not change underneath React.
      setLayout({
        nodes: sim.nodes().map((n) => ({ ...n })),
        links: (
          sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>
        )
          .links()
          .map((l) => ({
            ...l,
            source: { ...(l.source as SimNode) },
            target: { ...(l.target as SimNode) },
          })),
      });
    },
    [width, height],
  );

  // Build the simulation whenever the data or viewport changes.
  useEffect(() => {
    if (!data || data.nodes.length === 0) return;

    // Most-mentioned first, then capped: those are the entities the user
    // actually refers to, and they are what a map is for.
    const visible = [...data.nodes]
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, MAX_NODES);

    // Seed positions on a small ring rather than all at the exact centre —
    // coincident points give the charge force nothing to push against on the
    // first ticks.
    const nodes: SimNode[] = visible.map((n, i) => {
      const angle = (i / visible.length) * 2 * Math.PI;
      return {
        id: n.id,
        name: n.name,
        entityType: n.type,
        mentionCount: n.mentionCount,
        x: width / 2 + Math.cos(angle) * 40,
        y: height / 2 + Math.sin(angle) * 40,
      };
    });
    const ids = new Set(nodes.map((n) => n.id));
    const links: SimLink[] = data.edges
      .filter((e) => ids.has(e.sourceNodeId) && ids.has(e.targetNodeId))
      .map((e) => ({
        source: e.sourceNodeId,
        target: e.targetNodeId,
        relationType: e.type,
        description: e.description,
        mentionCount: e.mentionCount,
      }));

    const simulation = forceSimulation(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((n) => n.id)
          .distance(95)
          .strength(0.5),
      )
      .force('charge', forceManyBody().strength(-240))
      .force('center', forceCenter(width / 2, height / 2))
      .force(
        'collide',
        forceCollide<SimNode>().radius((n) => radiusOf(n) + 20),
      )
      .stop();

    simRef.current = simulation;
    solve(MAX_TICKS);

    return () => {
      simRef.current = null;
    };
  }, [data, width, height, solve]);

  /*
   * Selection deliberately does NOT re-run the simulation.
   *
   * It used to pull the tapped node toward the centre and re-solve 140 ticks
   * of n-body physics — synchronously, on the JS thread, on every single tap.
   * That is the lag: nothing else can run, so the tap feedback, the highlight
   * and any scroll all wait for the solver. Re-solving also moved every other
   * node, so the map you were reading rearranged itself underneath you each
   * time you touched it, which made the positions useless as a memory aid.
   *
   * Selection is now purely visual — the highlight below is a Set lookup. The
   * layout is computed once and stays put.
   */

  /**
   * What the selection lights up. Derived once per solve rather than inline,
   * because `isConnected` is called for every edge several times over during a
   * render and this is the largest list in the component.
   *
   * Declared above the early returns: hooks cannot live behind a condition.
   */
  const neighbourIds = useMemo(() => {
    const ids = new Set<number>();
    if (selectedId != null) {
      ids.add(selectedId);
      for (const l of layout.links) {
        const s = (l.source as SimNode).id;
        const t = (l.target as SimNode).id;
        if (s === selectedId || t === selectedId) {
          ids.add(s);
          ids.add(t);
        }
      }
    }
    return ids;
  }, [layout, selectedId]);

  // Stable identity so the memoised nodes are not invalidated every render.
  const handleNodePress = useCallback(
    (id: number) => onSelect(id === selectedId ? null : id),
    [onSelect, selectedId],
  );
  const deselect = useCallback(() => onSelect(null), [onSelect]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={[type.small, { color: colors.dangerText }]}>
          {error.message || 'Could not load the graph'}
        </Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  }

  if (data.nodes.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={[type.heading, { color: colors.text }]}>Nothing mapped yet</Text>
        <Text style={[type.small, styles.centred, { color: colors.textSubtle }]}>
          Tell Yamin about people and projects — every mention grows this map.
        </Text>
      </View>
    );
  }

  const hasSelection = selectedId != null;

  return (
    <View style={styles.viewport} {...pan.panHandlers}>
      <Animated.View style={viewStyle}>
        <Svg width={width} height={height}>
          {/* Tap empty space to deselect. */}
          <Rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill="transparent"
            {...pressProps(deselect)}
          />

          {layout.links.map((l, i) => {
            const s = l.source as SimNode;
            const t = l.target as SimNode;
            const lit = hasSelection && (s.id === selectedId || t.id === selectedId);
            const dim = hasSelection && !lit;
            return (
              <GraphEdge
                key={`e${i}`}
                x1={s.x ?? 0}
                y1={s.y ?? 0}
                x2={t.x ?? 0}
                y2={t.y ?? 0}
                stroke={lit ? colors.text : colors.borderStrong}
                strokeWidth={lit ? 2 : Math.min(2.5, 0.8 + l.mentionCount * 0.3)}
                strokeOpacity={dim ? 0.15 : lit ? 0.9 : 0.7}
              />
            );
          })}

          {/* Relation previews: the type of every edge touching the selection,
              labelled at the edge midpoint. */}
          {hasSelection &&
            layout.links.map((l, i) => {
              const s = l.source as SimNode;
              const t = l.target as SimNode;
              if (s.id !== selectedId && t.id !== selectedId) return null;
              const mx = ((s.x ?? 0) + (t.x ?? 0)) / 2;
              const my = ((s.y ?? 0) + (t.y ?? 0)) / 2;
              return (
                <SvgText
                  key={`lbl${i}`}
                  x={mx}
                  y={my - 5}
                  fontSize={9}
                  fontFamily={font.bodySemi}
                  fill={colors.textMuted}
                  textAnchor="middle"
                >
                  {l.relationType.replace(/_/g, ' ').toLowerCase()}
                </SvgText>
              );
            })}

          {layout.nodes.map((n) => {
            const selected = n.id === selectedId;
            return (
              <GraphNodeView
                key={n.id}
                id={n.id}
                x={n.x ?? 0}
                y={n.y ?? 0}
                r={radiusOf(n)}
                short={initials(n.name)}
                label={truncate(n.name, 16)}
                selected={selected}
                dimmed={hasSelection && !neighbourIds.has(n.id)}
                fill={selected ? colors.brand : colors.surface}
                stroke={selected ? colors.brand : colors.borderStrong}
                initialsColour={selected ? colors.onBrand : colors.text}
                labelColour={colors.textMuted}
                onPress={handleNodePress}
              />
            );
          })}
        </Svg>
      </Animated.View>
    </View>
  );
}

/** Distance between the first two touches, for pinch. */
function touchDistance(touches: { pageX: number; pageY: number }[]): number {
  const [a, b] = touches;
  if (!a || !b) return 0;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const styles = StyleSheet.create({
  // Clips the panned graph to the screen instead of letting it paint over the
  // header, and is the surface the pan responder listens on.
  viewport: { flex: 1, overflow: 'hidden' },
  centred: { textAlign: 'center' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.xl,
  },
});
