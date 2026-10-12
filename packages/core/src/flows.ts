/** A step or an ending in a flow chart, such as "Applied", in the column it's drawn in. */
export interface FlowNode {
  id: string;
  /** From 0 at the left. Nodes in a column stack in the order they're given, from the top. */
  column: number;
}

/** How many went from one node to another. */
export interface FlowLink {
  from: string;
  to: string;
  value: number;
}

/** The space a flow chart has, in pixels, apart from its labels. */
export interface FlowSize {
  width: number;
  height: number;
  /** How wide each node's bar is. */
  nodeWidth: number;
  /** The space between the nodes in a column. */
  gap: number;
}

/** A node where it's drawn: its bar's corner and height, and how many went through it. */
export interface PlacedNode {
  id: string;
  column: number;
  value: number;
  x: number;
  y: number;
  height: number;
}

/** A link where it's drawn: a band from one bar to the other, as an SVG path to fill. */
export interface PlacedLink extends FlowLink {
  /** The band's thickness. */
  width: number;
  path: string;
}

export interface FlowLayout {
  nodes: PlacedNode[];
  links: PlacedLink[];
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Lays out a flow chart (a Sankey diagram): each node a bar as tall as the count through it, in
 * its column, and each link a band as thick as its count, from the bars' sides. Columns stack
 * from the top, so a main path given first runs along the top and what leaves it peels off
 * below. Bands leave a bar in the order of where they're going, and arrive in the order of where
 * they left from, so they cross as little as the order allows.
 */
export function layoutFlows(
  nodes: readonly FlowNode[],
  links: readonly FlowLink[],
  size: FlowSize,
): FlowLayout {
  const used = links.filter((link) => link.value > 0);
  const total = (id: string, side: 'from' | 'to') =>
    used.filter((link) => link[side] === id).reduce((sum, link) => sum + link.value, 0);
  const valued = nodes
    .map((node) => ({ ...node, value: Math.max(total(node.id, 'from'), total(node.id, 'to')) }))
    .filter((node) => node.value > 0);
  const lastColumn = Math.max(1, ...valued.map((node) => node.column));
  const columns = new Map<number, typeof valued>();
  for (const node of valued) columns.set(node.column, [...(columns.get(node.column) ?? []), node]);

  // One scale for every column, so a count is as tall everywhere: the fullest column fits.
  const scale = Math.min(
    ...[...columns.values()].map((column) => {
      const sum = column.reduce((all, node) => all + node.value, 0);
      return (size.height - size.gap * (column.length - 1)) / sum;
    }),
  );
  const placed = new Map<string, PlacedNode>();
  for (const column of columns.values()) {
    let y = 0;
    for (const node of column) {
      const height = node.value * scale;
      placed.set(node.id, {
        id: node.id,
        column: node.column,
        value: node.value,
        x: (node.column * (size.width - size.nodeWidth)) / lastColumn,
        y,
        height,
      });
      y += height + size.gap;
    }
  }

  const bands = used.flatMap((link) => {
    const from = placed.get(link.from);
    const to = placed.get(link.to);
    return from && to ? [{ link, from, to, top: 0, bottom: 0 }] : [];
  });
  // Where each band leaves its bar: in the order of where they go, nearer columns first.
  const leaving = new Map<string, number>();
  for (const band of [...bands].sort(
    (a, b) => a.to.y - b.to.y || a.to.column - b.to.column || a.to.id.localeCompare(b.to.id),
  )) {
    const offset = leaving.get(band.from.id) ?? 0;
    band.top = band.from.y + offset;
    leaving.set(band.from.id, offset + band.link.value * scale);
  }
  // Where each arrives: in the order they left, from higher up, then from further away.
  const arriving = new Map<string, number>();
  for (const band of [...bands].sort(
    (a, b) => a.top - b.top || a.from.column - b.from.column || a.from.id.localeCompare(b.from.id),
  )) {
    const offset = arriving.get(band.to.id) ?? 0;
    band.bottom = band.to.y + offset;
    arriving.set(band.to.id, offset + band.link.value * scale);
  }

  return {
    nodes: [...placed.values()].map((node) => ({
      ...node,
      x: round(node.x),
      y: round(node.y),
      height: round(node.height),
    })),
    links: bands.map(({ link, from, to, top, bottom }) => {
      const width = link.value * scale;
      const x0 = round(from.x + size.nodeWidth);
      const x1 = round(to.x);
      const bend = round((x0 + x1) / 2);
      // Along the band's top edge, down its far end, and back along its bottom edge.
      const [topFrom, topTo] = [round(top), round(bottom)];
      const [bottomFrom, bottomTo] = [round(top + width), round(bottom + width)];
      return {
        ...link,
        width: round(width),
        path: [
          `M${x0},${topFrom}`,
          `C${bend},${topFrom} ${bend},${topTo} ${x1},${topTo}`,
          `L${x1},${bottomTo}`,
          `C${bend},${bottomTo} ${bend},${bottomFrom} ${x0},${bottomFrom}Z`,
        ].join(''),
      };
    }),
  };
}
