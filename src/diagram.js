let view = { x: 0, y: 0, scale: 1 };
let drag = null;
let stateLabelMap = new Map();

const GRID = 10;
const CHANNEL_GAP = 18;
const WIRE = "#71839a";
const INK = "#253244";
const CANVAS_WIDTH = 1380;

const SOURCE_X0 = 78;
const SOURCE_BASE_END_X = 320;
const RAIL_TAP_START_X = 350;
const SOURCE_RAIL_END_X = 500;
const LITERAL_TAP_GAP = 14;
const GATE_X = 520;
const OR_X = 720;
const FF_X = 990;
const OUTPUT_X = 1160;

const LEGEND_Y = 38;
const LEGEND_BOTTOM_Y = 126;
const RAIL_BASE_Y = 210;
const RAIL_GAP = 42;
const FF_TOP_Y = 190;
const FF_GAP = 190;
const FEEDBACK_TOP_Y = 138;
const FEEDBACK_LEFT_X = 44;
const FEEDBACK_RIGHT_X = 1210;
const FEEDBACK_VERTICAL_GAP = 20;
const FEEDBACK_HORIZONTAL_GAP = 18;
const FEEDBACK_LEFT_GAP = 12;
const LOGIC_MIN_Y = 224;
const TERM_VERTICAL_GAP = 26;
const NETWORK_VERTICAL_GAP = 34;

export function resetDiagramView() {
  view = { x: 0, y: 0, scale: 1 };
}

export function zoomDiagram(svg, delta) {
  view.scale = Math.min(2.2, Math.max(0.55, view.scale + delta));
  applyView(svg);
}

export function bindDiagramPan(svg) {
  svg.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    svg.setPointerCapture(event.pointerId);
  });

  svg.addEventListener("pointermove", (event) => {
    if (!drag) return;
    view.x = drag.vx + (event.clientX - drag.x) / view.scale;
    view.y = drag.vy + (event.clientY - drag.y) / view.scale;
    applyView(svg);
  });

  svg.addEventListener("pointerup", () => {
    drag = null;
  });
}

export function renderCircuitDiagram(svg, analysis) {
  if (!analysis) return;

  stateLabelMap = new Map(analysis.variables.state.map((name, index) => [name, String.fromCharCode(65 + index)]));

  const sourceRows = buildSourceRows(analysis);
  const ffPositions = flipFlopPositions(analysis);
  const provisionalFfMap = new Map(ffPositions.map((ff) => [ff.name, ff]));
  const outputY = snap(
    Math.max(
      RAIL_BASE_Y + Math.max(0, sourceRows.size - 1) * RAIL_GAP + 170,
      FF_TOP_Y + Math.max(1, ffPositions.length) * FF_GAP + 72
    )
  );
  const logicLanes = assignLogicLanes(analysis.equations, provisionalFfMap, outputY);
  const maxLogicY = Math.max(outputY, ...logicLanes.values());
  const clockY = snap(maxLogicY + 190);
  const height = Math.max(760, clockY + 70);

  svg.innerHTML = "";
  svg.setAttribute("viewBox", `0 0 ${CANVAS_WIDTH} ${height}`);

  const root = createSvgElement("g", { id: "viewportRoot" });
  const wires = createSvgElement("g", { id: "wireLayer" });
  const components = createSvgElement("g", { id: "componentLayer" });
  const labels = createSvgElement("g", { id: "labelLayer" });
  const dots = createSvgElement("g", { id: "junctionLayer" });
  root.append(wires, components, labels, dots);
  svg.appendChild(root);

  const ctx = { wires, components, labels, dots, nextTap: 0 };

  drawEquationLegend(ctx, analysis.equations);
  drawSourceRails(ctx, sourceRows);
  const ffMap = drawFlipFlops(ctx, ffPositions);
  drawFeedbackWires(ctx, sourceRows, ffMap, analysis);
  drawEquations(ctx, analysis, sourceRows, ffMap, outputY, logicLanes);
  drawClock(ctx, ffMap, clockY);

  applyView(svg);
}

function drawEquationLegend(ctx, equations) {
  text(ctx.labels, 72, LEGEND_Y, "Simplified Equations", "start", 16, false);
  equations.forEach((equation, index) => {
    const x = 72 + (index % 3) * 350;
    const y = LEGEND_Y + 34 + Math.floor(index / 3) * 28;
    text(ctx.labels, x, y, `${formatEquationName(equation.name)} = ${formatExpression(equation.expression)}`, "start", 15, true);
  });
  line(ctx.wires, 56, LEGEND_BOTTOM_Y, 1180, LEGEND_BOTTOM_Y, "#d8e0ea", 1.2);
}

function drawSourceRails(ctx, sourceRows) {
  const xRail = sourceRows.get("X");
  const invertedX = sourceRows.get("X'");

  for (const source of sourceRows.values()) {
    if (source.name === "X'") continue;
    line(ctx.wires, SOURCE_X0, source.y, SOURCE_RAIL_END_X, source.y);
    if (isExternalInputSignal(source.name)) {
      text(ctx.labels, SOURCE_X0 - 14, source.y, source.label, "end", 15, true);
    }
  }

  if (xRail && invertedX) {
    drawInputInverter(ctx, xRail, invertedX);
  }
}

function drawInputInverter(ctx, normal, inverted) {
  const tapX = SOURCE_X0 + 58;
  const gateX = SOURCE_X0 + 84;
  const gate = notGate(ctx.components, gateX, normal.y - 18, 34, 36);

  line(ctx.wires, tapX, normal.y, gateX, normal.y);
  junction(ctx.dots, tapX, normal.y);
  polyline(ctx.wires, [
    [gate.outX, gate.outY],
    [gate.outX + 22, gate.outY],
    [gate.outX + 22, inverted.y],
    [SOURCE_RAIL_END_X, inverted.y],
  ]);
  text(ctx.labels, gate.outX + 34, inverted.y - 12, "X'", "start", 14, true);
}

function drawFeedbackWires(ctx, sourceRows, ffMap, analysis) {
  let feedbackIndex = 0;

  analysis.variables.state.forEach((qName) => {
    const ff = ffMap.get(qName);
    if (!ff) return;

    const normal = sourceRows.get(qName);
    if (normal) {
      routeFeedbackToRail(ctx, ff.outputs.normal, normal, feedbackIndex);
      feedbackIndex += 1;
    }

    const inverted = sourceRows.get(`${qName}'`);
    if (inverted) {
      routeFeedbackToRail(ctx, ff.outputs.inverted, inverted, feedbackIndex);
      feedbackIndex += 1;
    }
  });
}

function routeFeedbackToRail(ctx, output, source, feedbackIndex) {
  const turnX = snap(FEEDBACK_RIGHT_X + feedbackIndex * FEEDBACK_VERTICAL_GAP);
  const trackY = snap(FEEDBACK_TOP_Y + feedbackIndex * FEEDBACK_HORIZONTAL_GAP);
  const leftX = snap(FEEDBACK_LEFT_X - feedbackIndex * FEEDBACK_LEFT_GAP);

  polyline(ctx.wires, [
    [output.x, output.y],
    [turnX, output.y],
    [turnX, trackY],
    [leftX, trackY],
    [leftX, source.y],
    [SOURCE_X0, source.y],
  ]);
}

function drawEquations(ctx, analysis, sourceRows, ffMap, outputY, logicLanes) {
  analysis.equations.forEach((equation, index) => {
    const target = getEquationTarget(equation, ffMap, outputY);
    const logicY = logicLanes.get(equation.name) ?? target.y;
    const output = drawExpressionNetwork(ctx, equation.expression, sourceRows, logicY, index);
    routeOutputToTarget(ctx.wires, output, target, index);

    if (target.kind === "output") {
      text(ctx.labels, target.x + 16, target.y, "Z", "start", 16, true);
    }
  });
}

function drawExpressionNetwork(ctx, expression, sourceRows, y, laneIndex) {
  if (expression === "0" || expression === "1") {
    const constant = constantNode(ctx.components, ctx.labels, GATE_X, y - 16, expression);
    return { x: constant.outX, y: constant.outY };
  }

  const terms = sortTermsBySourceY(splitTerms(expression), sourceRows);
  if (terms.length === 1) {
    return drawProductTerm(ctx, terms[0], sourceRows, y, laneIndex, 0);
  }

  const termLayouts = layoutProductTerms(terms, y);
  const totalTermHeight = termLayouts.at(-1).bottom - termLayouts[0].top;
  const orGateHeight = Math.max(58, totalTermHeight + 18);
  const or = orGate(ctx.components, OR_X, y - orGateHeight / 2, 96, orGateHeight, terms.length);
  termLayouts.forEach(({ term, centerY }, termIndex) => {
    const product = drawProductTerm(ctx, term, sourceRows, centerY, laneIndex, termIndex);
    const input = or.inputs[termIndex];
    const routeX = snap(OR_X - 42 - termIndex * CHANNEL_GAP);
    polyline(ctx.wires, [
      [product.x, product.y],
      [routeX, product.y],
      [routeX, input.y],
      [input.x, input.y],
    ]);
  });

  return { x: or.outX, y: or.outY };
}

function drawProductTerm(ctx, term, sourceRows, y, laneIndex, termIndex) {
  if (term === "0" || term === "1") {
    const constant = constantNode(ctx.components, ctx.labels, GATE_X, y - 16, term);
    return { x: constant.outX, y: constant.outY };
  }

  const literals = sortLiteralsBySourceY(parseLiterals(term), sourceRows);

  if (literals.length === 1) {
    const point = { x: GATE_X + 76, y };
    routeLiteralToPoint(ctx, literals[0], sourceRows, point);
    return point;
  }

  const gateHeight = productTermHeight(term);
  const gate = andGate(ctx.components, GATE_X, y - gateHeight / 2, 82, gateHeight, literals.length);
  literals.forEach((literal, literalIndex) => {
    routeLiteralToPoint(ctx, literal, sourceRows, gate.inputs[literalIndex]);
  });
  return { x: gate.outX, y: gate.outY };
}

function routeLiteralToPoint(ctx, literal, sourceRows, point) {
  const source = sourceRows.get(literal);
  if (!source) {
    throw new Error(`Diagram source missing for literal ${literal}.`);
  }

  const tapX = snap(RAIL_TAP_START_X + ctx.nextTap * LITERAL_TAP_GAP);
  ctx.nextTap += 1;

  junction(ctx.dots, tapX, source.y);
  polyline(ctx.wires, [
    [tapX, source.y],
    [tapX, point.y],
    [point.x, point.y],
  ]);
}

function routeOutputToTarget(wires, output, target, laneIndex) {
  if (Math.abs(output.y - target.y) < 1) {
    line(wires, output.x, output.y, target.x, target.y);
    return;
  }

  const routeX = snap(target.x - 56 - laneIndex * 8);
  polyline(wires, [
    [output.x, output.y],
    [routeX, output.y],
    [routeX, target.y],
    [target.x, target.y],
  ]);
}

function drawFlipFlops(ctx, positions) {
  const map = new Map();
  positions.forEach((ff) => {
    flipFlop(ctx, ff.x, ff.y, ff);
    map.set(ff.name, ff);
  });
  return map;
}

function drawClock(ctx, ffMap, clockY) {
  line(ctx.wires, SOURCE_X0, clockY, 1140, clockY);
  text(ctx.labels, SOURCE_X0 - 14, clockY, "CLK", "end", 15, true);
  text(ctx.labels, 1160, clockY, "CLK", "start", 15, true);

  const dotted = new Set();
  for (const ff of ffMap.values()) {
    const x = ff.x + ff.width / 2;
    polyline(ctx.wires, [
      [x, clockY],
      [x, ff.clockY],
    ]);
    const dotKey = `${snap(x)},${snap(clockY)}`;
    if (!dotted.has(dotKey)) {
      junction(ctx.dots, x, clockY);
      dotted.add(dotKey);
    }
  }
}

function buildSourceRows(analysis) {
  const used = activeLiterals(analysis);
  const ordered = [];

  if (used.has("X") || used.has("X'")) ordered.push("X");
  if (used.has("X'")) ordered.push("X'");

  analysis.variables.state.forEach((name) => {
    if (used.has(name)) ordered.push(name);
    if (used.has(`${name}'`)) ordered.push(`${name}'`);
  });

  return new Map(
    ordered.map((name, index) => [
      name,
      {
        name,
        label: formatSourceLabel(name),
        y: snap(RAIL_BASE_Y + index * RAIL_GAP),
      },
    ])
  );
}

function activeLiterals(analysis) {
  const used = new Set();
  analysis.equations.forEach((equation) => {
    parseLiterals(equation.expression).forEach((literal) => used.add(literal));
  });
  return used;
}

function assignLogicLanes(equations, ffMap, outputY) {
  const sorted = equations
    .map((equation, index) => ({
      equation,
      index,
      targetY: getEquationTarget(equation, ffMap, outputY).y,
      blockHeight: expressionBlockHeight(equation.expression),
    }))
    .sort((a, b) => a.targetY - b.targetY || a.index - b.index);

  const lanes = new Map();
  let previousBottom = LOGIC_MIN_Y - NETWORK_VERTICAL_GAP;

  sorted.forEach(({ equation, targetY, blockHeight }) => {
    const halfHeight = blockHeight / 2;
    const laneY = snap(Math.max(targetY, previousBottom + NETWORK_VERTICAL_GAP + halfHeight));
    lanes.set(equation.name, laneY);
    previousBottom = laneY + halfHeight;
  });

  return lanes;
}

function getEquationTarget(equation, ffMap, outputY) {
  if (equation.type === "output") {
    return { kind: "output", x: OUTPUT_X, y: outputY };
  }

  const ffName = equation.name.match(/Q\d+$/)?.[0];
  const ff = ffMap.get(ffName);
  if (!ff) throw new Error(`Diagram target missing for ${equation.name}.`);

  const prefix = equation.name[0];
  if (prefix === "K" || prefix === "R") return { kind: "ff", x: ff.x, y: ff.inputs.lower.y };
  if (prefix === "T" || prefix === "D") return { kind: "ff", x: ff.x, y: ff.inputs.single.y };
  return { kind: "ff", x: ff.x, y: ff.inputs.upper.y };
}

function flipFlopPositions(analysis) {
  return analysis.graph.flipFlops.map((ff, index) => {
    const x = FF_X;
    const y = FF_TOP_Y + index * FF_GAP;
    const width = 150;
    const height = 112;
    const label = formatStateName(ff.name);
    const hasTwoInputs = ff.type === "JK" || ff.type === "SR";
    return {
      ...ff,
      label,
      x,
      y,
      width,
      height,
      inputs: hasTwoInputs
        ? {
            upper: { x, y: y + 34 },
            lower: { x, y: y + 72 },
          }
        : {
            single: { x, y: y + 54 },
          },
      outputs: {
        normal: { x: x + width + 42, y: y + 36 },
        inverted: { x: x + width + 42, y: y + 74 },
      },
      clockY: y + height,
    };
  });
}

function flipFlop(ctx, x, y, ff) {
  rect(ctx.components, x, y, ff.width, ff.height, "#ffffff", WIRE, 1.8);

  if (ff.type === "JK" || ff.type === "SR") {
    const [upperPrefix, lowerPrefix] = ff.type === "JK" ? ["J", "K"] : ["S", "R"];
    text(ctx.labels, x + 18, ff.inputs.upper.y, `${upperPrefix}${ff.label}`, "start", 14, true);
    text(ctx.labels, x + 18, ff.inputs.lower.y, `${lowerPrefix}${ff.label}`, "start", 14, true);
  } else {
    const prefix = ff.type === "D" ? "D" : "T";
    text(ctx.labels, x + 18, ff.inputs.single.y, `${prefix}${ff.label}`, "start", 14, true);
  }

  line(ctx.wires, x + ff.width, y + 36, ff.outputs.normal.x, ff.outputs.normal.y);
  line(ctx.wires, x + ff.width, y + 74, ff.outputs.inverted.x, ff.outputs.inverted.y);
  text(ctx.labels, ff.outputs.normal.x + 12, ff.outputs.normal.y, ff.label, "start", 13, true);
  text(ctx.labels, ff.outputs.inverted.x + 12, ff.outputs.inverted.y, `${ff.label}'`, "start", 13, true);

  path(ctx.components, `M ${x + 65} ${y + ff.height} L ${x + 75} ${y + ff.height - 12} L ${x + 85} ${y + ff.height}`, WIRE, "none", 1.5);
  text(ctx.labels, x + 75, y + ff.height + 14, "CLK", "middle", 11, false);
}

function andGate(components, x, y, width, height, inputCount) {
  const d = [
    `M ${x} ${y}`,
    `L ${x + width / 2} ${y}`,
    `C ${x + width} ${y}, ${x + width} ${y + height}, ${x + width / 2} ${y + height}`,
    `L ${x} ${y + height}`,
    "Z",
  ].join(" ");
  path(components, d, WIRE, "#ffffff", 1.7);
  return {
    inputs: inputPins(x, y, height, inputCount),
    outX: x + width,
    outY: y + height / 2,
  };
}

function orGate(components, x, y, width, height, inputCount) {
  const d = [
    `M ${x} ${y}`,
    `C ${x + 28} ${y + 10}, ${x + 28} ${y + height - 10}, ${x} ${y + height}`,
    `C ${x + 44} ${y + height - 8}, ${x + width - 22} ${y + height - 5}, ${x + width} ${y + height / 2}`,
    `C ${x + width - 22} ${y + 5}, ${x + 44} ${y + 8}, ${x} ${y}`,
  ].join(" ");
  path(components, d, WIRE, "#ffffff", 1.8);
  return {
    inputs: inputPins(x + 5, y, height, inputCount),
    outX: x + width,
    outY: y + height / 2,
  };
}

function notGate(components, x, y, width, height) {
  path(components, `M ${x} ${y} L ${x} ${y + height} L ${x + width} ${y + height / 2} Z`, WIRE, "#ffffff", 1.6);
  circle(components, x + width + 6, y + height / 2, 4, "#ffffff", WIRE, 1.5);
  return { outX: x + width + 10, outY: y + height / 2 };
}

function constantNode(components, labels, x, y, value) {
  const label = value === "1" ? "VCC" : "GND";
  rect(components, x, y, 62, 32, "#ffffff", WIRE, 1.5);
  text(labels, x + 31, y + 16, label, "middle", 14, true);
  return { outX: x + 62, outY: y + 16 };
}

function inputPins(x, y, height, count) {
  return Array.from({ length: count }, (_, index) => ({
    x,
    y: y + ((index + 1) * height) / (count + 1),
  }));
}

function splitTerms(expression) {
  if (expression === "0" || expression === "1") return [expression];
  return expression.split("+").map((term) => term.trim()).filter(Boolean);
}

function parseLiterals(term) {
  if (term === "0" || term === "1") return [];
  return term.match(/Q\d+'?|X'?/g) ?? [];
}

function layoutProductTerms(terms, centerY) {
  const items = terms.map((term) => ({ term, height: productTermHeight(term) }));
  const totalHeight =
    items.reduce((sum, item) => sum + item.height, 0) + Math.max(0, items.length - 1) * TERM_VERTICAL_GAP;
  let cursor = centerY - totalHeight / 2;

  return items.map((item) => {
    const top = cursor;
    const center = top + item.height / 2;
    cursor += item.height + TERM_VERTICAL_GAP;
    return {
      term: item.term,
      top,
      bottom: top + item.height,
      centerY: snap(center),
    };
  });
}

function expressionBlockHeight(expression) {
  const terms = splitTerms(expression);
  if (terms.length <= 1) return productTermHeight(terms[0] ?? expression);
  return terms.reduce((sum, term) => sum + productTermHeight(term), 0) + (terms.length - 1) * TERM_VERTICAL_GAP;
}

function productTermHeight(term) {
  if (term === "0" || term === "1") return 32;
  const literalCount = parseLiterals(term).length;
  if (literalCount <= 1) return 36;
  return Math.max(54, literalCount * 24 + 18);
}

function sortTermsBySourceY(terms, sourceRows) {
  return [...terms].sort((a, b) => termSourceY(a, sourceRows) - termSourceY(b, sourceRows));
}

function sortLiteralsBySourceY(literals, sourceRows) {
  return [...literals].sort((a, b) => sourceY(a, sourceRows) - sourceY(b, sourceRows));
}

function termSourceY(term, sourceRows) {
  const literals = parseLiterals(term);
  if (!literals.length) return Number.POSITIVE_INFINITY;
  return Math.min(...literals.map((literal) => sourceY(literal, sourceRows)));
}

function sourceY(literal, sourceRows) {
  return sourceRows.get(literal)?.y ?? Number.POSITIVE_INFINITY;
}

function formatEquationName(name) {
  return name.replace(/Q\d+/g, (qName) => stateLabelMap.get(qName) ?? qName);
}

function formatExpression(expression) {
  return expression.replace(/Q\d+/g, (qName) => stateLabelMap.get(qName) ?? qName).replace(/\s+/g, "");
}

function formatSourceLabel(literal) {
  const inverted = literal.endsWith("'");
  const base = inverted ? literal.slice(0, -1) : literal;
  if (!base.startsWith("Q")) return `${base}${inverted ? "'" : ""}`;
  return `${formatStateName(base)}${inverted ? "'" : ""}`;
}

function isExternalInputSignal(name) {
  return name === "X" || name === "X'";
}

function formatStateName(name) {
  return stateLabelMap.get(name) ?? name;
}

function snap(value) {
  return Math.round(value / GRID) * GRID;
}

function polyline(root, points, stroke = WIRE, width = 1.5) {
  const element = createSvgElement("polyline", {
    points: points.map(([x, y]) => `${snap(x)},${snap(y)}`).join(" "),
    fill: "none",
    stroke,
    "stroke-width": width,
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
  });
  root.appendChild(element);
}

function line(root, x1, y1, x2, y2, stroke = WIRE, width = 1.5) {
  root.appendChild(
    createSvgElement("line", {
      x1: snap(x1),
      y1: snap(y1),
      x2: snap(x2),
      y2: snap(y2),
      stroke,
      "stroke-width": width,
      "stroke-linecap": "round",
    })
  );
}

function rect(root, x, y, width, height, fill, stroke, strokeWidth) {
  root.appendChild(createSvgElement("rect", { x: snap(x), y: snap(y), width, height, fill, stroke, "stroke-width": strokeWidth }));
}

function circle(root, cx, cy, r, fill, stroke, strokeWidth) {
  root.appendChild(createSvgElement("circle", { cx: snap(cx), cy: snap(cy), r, fill, stroke, "stroke-width": strokeWidth }));
}

function junction(root, cx, cy) {
  circle(root, cx, cy, 3, INK, INK, 1);
}

function path(root, d, stroke, fill, strokeWidth) {
  root.appendChild(
    createSvgElement("path", {
      d,
      fill,
      stroke,
      "stroke-width": strokeWidth,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
    })
  );
}

function text(root, x, y, value, anchor = "start", size = 14, italic = false) {
  const node = createSvgElement("text", {
    x: snap(x),
    y: snap(y),
    "text-anchor": anchor,
    "dominant-baseline": "middle",
    fill: INK,
    "font-size": size,
    "font-weight": italic ? 700 : 500,
    "font-family": italic ? "Georgia, Times New Roman, serif" : "Segoe UI, sans-serif",
    "font-style": italic ? "italic" : "normal",
  });
  node.textContent = value;
  root.appendChild(node);
}

function createSvgElement(tag, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function applyView(svg) {
  const root = svg.querySelector("#viewportRoot");
  if (!root) return;
  root.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.scale})`);
}
