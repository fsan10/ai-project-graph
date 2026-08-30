export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasRect extends CanvasPoint {
  width: number;
  height: number;
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

export function rangeSelection(order: string[], anchorId: string | null, targetId: string) {
  const targetIndex = order.indexOf(targetId);
  const anchorIndex = anchorId ? order.indexOf(anchorId) : -1;
  if (targetIndex < 0) return [];
  if (anchorIndex < 0) return [targetId];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return order.slice(start, end + 1);
}
