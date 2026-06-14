import assert from "node:assert/strict";
import { analyzeCircuit, examples } from "../src/logic.js";

global.document = {
  createElementNS(_namespace, tag) {
    return new FakeElement(tag);
  },
};

const { renderCircuitDiagram } = await import("../src/diagram.js");

function assertDiagramRenders(analysis) {
  const svg = new FakeElement("svg");
  renderCircuitDiagram(svg, analysis);

  const [minX, minY, width, height] = svg.attributes.viewBox.split(/\s+/).map(Number);
  assert.equal(minX, 0);
  assert.equal(minY, 0);
  assert.ok(width >= 1380, "diagram width should scale from the default canvas");
  assert.ok(height >= 760, "diagram height should scale from the default canvas");

  const segments = collectSegments(svg);
  const rects = collectRects(svg);

  for (const segment of segments) {
    assert.ok(segment.x1 === segment.x2 || segment.y1 === segment.y2, "wire segment must be orthogonal");
    assert.ok(segment.x1 >= 0 && segment.x2 >= 0 && segment.y1 >= 0 && segment.y2 >= 0, "wire segment must stay in canvas bounds");
  }

  for (const segment of segments) {
    for (const rect of rects) {
      assert.ok(
        !segmentCrossesRectInterior(segment, rect),
        `wire must not pierce a component rectangle: ${JSON.stringify({ segment, rect })}`
      );
    }
  }
}

function collectSegments(root) {
  const segments = [];
  for (const node of walk(root)) {
    if (node.tag === "line") {
      segments.push({
        x1: Number(node.attributes.x1),
        y1: Number(node.attributes.y1),
        x2: Number(node.attributes.x2),
        y2: Number(node.attributes.y2),
      });
    }
    if (node.tag === "polyline") {
      const points = node.attributes.points.split(/\s+/).map((pair) => pair.split(",").map(Number));
      for (let index = 1; index < points.length; index += 1) {
        segments.push({
          x1: points[index - 1][0],
          y1: points[index - 1][1],
          x2: points[index][0],
          y2: points[index][1],
        });
      }
    }
  }
  return segments;
}

function collectRects(root) {
  return [...walk(root)]
    .filter((node) => node.tag === "rect")
    .map((node) => ({
      x: Number(node.attributes.x),
      y: Number(node.attributes.y),
      width: Number(node.attributes.width),
      height: Number(node.attributes.height),
    }));
}

function segmentCrossesRectInterior(segment, rect) {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;

  if (segment.x1 === segment.x2) {
    const x = segment.x1;
    if (x <= left || x >= right) return false;
    return rangeOverlapLength(segment.y1, segment.y2, top, bottom) > 0;
  }

  const y = segment.y1;
  if (y <= top || y >= bottom) return false;
  return rangeOverlapLength(segment.x1, segment.x2, left, right) > 0;
}

function rangeOverlapLength(a1, a2, b1, b2) {
  const low = Math.max(Math.min(a1, a2), b1);
  const high = Math.min(Math.max(a1, a2), b2);
  return Math.max(0, high - low);
}

function* walk(node) {
  yield node;
  for (const child of node.children) {
    yield* walk(child);
  }
}

function makeRows(count) {
  const names = Array.from({ length: count }, (_, index) => String.fromCharCode(65 + index));
  return names.map((name, index) => ({
    state: name,
    next0: names[(index + 1) % count],
    next1: names[(index + 3) % count],
    out0: String(index % 2),
    out1: String((index + 1) % 2),
  }));
}

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.attributes = {};
    this.children = [];
    this.textContent = "";
  }

  setAttribute(key, value) {
    this.attributes[key] = String(value);
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
  }

  querySelector(selector) {
    if (!selector.startsWith("#")) return null;
    const id = selector.slice(1);
    return [...walk(this)].find((node) => node.attributes.id === id) ?? null;
  }

  set innerHTML(_value) {
    this.children = [];
  }
}

for (const ffType of ["jk", "t", "sr", "d"]) {
  assertDiagramRenders(analyzeCircuit(examples.mealyThreeOnes.rows, "mealy", ffType));
}

assertDiagramRenders(analyzeCircuit(makeRows(9), "mealy", "jk"));

console.log("diagram tests passed");
