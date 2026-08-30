import assert from "node:assert/strict";
import test from "node:test";

import { nodesInMarquee, rangeSelection, rectFromPoints } from "../lib/canvas.ts";

test("marquee selection works in every drag direction", () => {
  const nodes = [
    { id: "a", x: 20, y: 20, width: 100, height: 60 },
    { id: "b", x: 180, y: 20, width: 100, height: 60 },
  ];
  const marquee = rectFromPoints({ x: 150, y: 100 }, { x: 10, y: 10 });
  assert.deepEqual(marquee, { x: 10, y: 10, width: 140, height: 90 });
  assert.deepEqual(nodesInMarquee(nodes, marquee), ["a"]);
});

test("shift selection follows the stable node order", () => {
  assert.deepEqual(rangeSelection(["a", "b", "c", "d"], "b", "d"), ["b", "c", "d"]);
  assert.deepEqual(rangeSelection(["a", "b", "c", "d"], "d", "b"), ["b", "c", "d"]);
});
