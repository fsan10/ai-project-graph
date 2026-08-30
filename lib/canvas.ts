export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasRect extends CanvasPoint {
  width: number;
  height: number;
}

export interface CanvasNodeRect extends CanvasRect {
  id: string;
}

export interface CanvasEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
}

export function rectFromPoints(start: CanvasPoint, end: CanvasPoint): CanvasRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function nodesInMarquee<T extends CanvasRect & { id: string }>(nodes: T[], marquee: CanvasRect) {
  const right = marquee.x + marquee.width;
  const bottom = marquee.y + marquee.height;
  return nodes.filter((node) => (
    node.x < right
    && node.x + node.width > marquee.x
    && node.y < bottom
    && node.y + node.height > marquee.y
  )).map((node) => node.id);
}

function pointInRect(point: CanvasPoint, rect: CanvasRect) {
  return point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height;
}

function cross(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return ((abC <= 0 && abD >= 0) || (abC >= 0 && abD <= 0))
    && ((cdA <= 0 && cdB >= 0) || (cdA >= 0 && cdB <= 0));
}

/** Selects an edge when the line between its node centres touches the marquee. */
export function edgesInMarquee<T extends CanvasEdge>(
  edges: T[],
  nodes: CanvasNodeRect[],
  marquee: CanvasRect,
) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const topLeft = { x: marquee.x, y: marquee.y };
  const topRight = { x: marquee.x + marquee.width, y: marquee.y };
  const bottomRight = { x: marquee.x + marquee.width, y: marquee.y + marquee.height };
  const bottomLeft = { x: marquee.x, y: marquee.y + marquee.height };
  const sides = [
    [topLeft, topRight], [topRight, bottomRight],
    [bottomRight, bottomLeft], [bottomLeft, topLeft],
  ] as const;

  return edges.filter((edge) => {
    const source = nodeMap.get(edge.sourceNodeId);
    const target = nodeMap.get(edge.targetNodeId);
    if (!source || !target) return false;
    const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
    const end = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    return pointInRect(start, marquee)
      || pointInRect(end, marquee)
      || sides.some(([a, b]) => segmentsIntersect(start, end, a, b));
  }).map((edge) => edge.id);
}

export function rangeSelection(order: string[], anchorId: string | null, targetId: string) {
  const targetIndex = order.indexOf(targetId);
  const anchorIndex = anchorId ? order.indexOf(anchorId) : -1;
  if (targetIndex < 0) return [];
  if (anchorIndex < 0) return [targetId];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return order.slice(start, end + 1);
}
