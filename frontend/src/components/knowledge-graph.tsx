import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  Simulation,
  SimulationLinkDatum,
  SimulationNodeDatum,
} from 'd3-force';

import { api, GraphData } from '../lib/api';
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
/** Below this the layout has visually settled — running on past it only shivers. */
const REST_ALPHA = 0.015;
/** Ceiling on ticks per solve, so a pathological graph can't hang the thread. */
const MAX_TICKS = 400;
/** A reheat after a tap starts from a settled layout and needs far less work. */
const RESELECT_TICKS = 140;

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
 * So the simulation now runs to rest inside one synchronous pass and the result
 * is painted exactly once. Tapping a node reheats it with that node pulled
 * toward the middle and re-solves the same way: one pass, one render, no frame
 * loop at all. Its connected relations light up with their type as a label —
 * the preview of what Yamin actually knows about that thing — while everything
 * unrelated fades back.
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
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    api
      .graph(token)
      .then((g) => !cancelled && setData(g))
      .catch((e) => !cancelled && setError(e.message ?? 'Could not load the graph'));
    return () => {
      cancelled = true;
    };
  }, [token]);

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

    // Seed positions on a small ring rather than all at the exact centre —
    // coincident points give the charge force nothing to push against on the
    // first ticks.
    const nodes: SimNode[] = data.nodes.map((n, i) => {
      const angle = (i / data.nodes.length) * 2 * Math.PI;
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
      // Focus forces sit at strength 0 until a node is selected.
      .force('focusX', forceX<SimNode>(width / 2).strength(0))
      .force('focusY', forceY<SimNode>(height / 2).strength(0))
      .stop();

    simRef.current = simulation;
    solve(MAX_TICKS);

    return () => {
      simRef.current = null;
    };
  }, [data, width, height, solve]);

  // Selection: pull the chosen node toward the centre and re-solve, so the
  // graph rearranges itself around what you're looking at.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const strength = (n: SimNode) => (n.id === selectedId ? 0.16 : 0);
    (sim.force('focusX') as ReturnType<typeof forceX<SimNode>>)?.strength(strength);
    (sim.force('focusY') as ReturnType<typeof forceY<SimNode>>)?.strength(strength);
    sim.alpha(selectedId != null ? 0.55 : 0.25);
    solve(RESELECT_TICKS);
  }, [selectedId, solve]);

  /**
   * What the selection lights up. Derived once per solve rather than inline,
   * because `isConnected` is called for every edge several times over during a
   * render and this is the largest list in the component.
   *
   * Declared above the early returns: hooks cannot live behind a condition.
   */
  const { nodes, links, neighbourIds } = useMemo(() => {
    const isConnected = (l: SimLink) =>
      (l.source as SimNode).id === selectedId ||
      (l.target as SimNode).id === selectedId;

    const ids = new Set<number>();
    if (selectedId != null) {
      ids.add(selectedId);
      for (const l of layout.links) {
        if (isConnected(l)) {
          ids.add((l.source as SimNode).id);
          ids.add((l.target as SimNode).id);
        }
      }
    }
    return { nodes: layout.nodes, links: layout.links, neighbourIds: ids };
  }, [layout, selectedId]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={[type.small, { color: colors.dangerText }]}>{error}</Text>
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
        <Text style={[type.small, { color: colors.textSubtle, textAlign: 'center' }]}>
          Tell Yamin about people and projects — every mention grows this map.
        </Text>
      </View>
    );
  }

  const hasSelection = selectedId != null;
  const isConnected = (l: SimLink) =>
    (l.source as SimNode).id === selectedId || (l.target as SimNode).id === selectedId;

  return (
    <Svg width={width} height={height}>
      {/* Tap empty space to deselect. */}
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="transparent"
        {...pressProps(() => onSelect(null))}
      />

      {links.map((l, i) => {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        const lit = hasSelection && isConnected(l);
        const dim = hasSelection && !lit;
        return (
          <Line
            key={`e${i}`}
            x1={s.x}
            y1={s.y}
            x2={t.x}
            y2={t.y}
            stroke={lit ? colors.text : colors.borderStrong}
            strokeWidth={lit ? 2 : Math.min(2.5, 0.8 + l.mentionCount * 0.3)}
            strokeOpacity={dim ? 0.15 : lit ? 0.9 : 0.7}
          />
        );
      })}

      {/* Relation previews: the type of every edge touching the selection,
          labelled at the edge midpoint. */}
      {hasSelection &&
        links.filter(isConnected).map((l, i) => {
          const s = l.source as SimNode;
          const t = l.target as SimNode;
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

      {nodes.map((n) => {
        const r = radiusOf(n);
        const selected = n.id === selectedId;
        const dimmed = hasSelection && !neighbourIds.has(n.id);
        return (
          <G key={n.id} opacity={dimmed ? 0.25 : 1}>
            <Circle
              cx={n.x}
              cy={n.y}
              r={r}
              fill={selected ? colors.brand : colors.surface}
              stroke={selected ? colors.brand : colors.borderStrong}
              strokeWidth={selected ? 2 : 1.5}
              {...pressProps(() => onSelect(selected ? null : n.id))}
            />
            <SvgText
              x={n.x}
              y={(n.y ?? 0) + 4}
              fontSize={r >= 14 ? 11 : 9}
              fontFamily={font.bodySemi}
              fill={selected ? colors.onBrand : colors.text}
              textAnchor="middle"
              {...pressProps(() => onSelect(selected ? null : n.id))}
            >
              {initials(n.name)}
            </SvgText>
            <SvgText
              x={n.x}
              y={(n.y ?? 0) + r + 14}
              fontSize={10}
              fontFamily={font.body}
              fill={colors.textMuted}
              textAnchor="middle"
            >
              {truncate(n.name, 16)}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.xl,
  },
});
