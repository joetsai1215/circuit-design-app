let view = { x: 0, y: 0, scale: 1 };
let drag = null;
let stateLabelMap = new Map();

const GRID = 12;
const TRACK = 18;
const WIRE = "#71839a";
const INK = "#253244";
const SOURCE_X0 = 70;
const SOURCE_X1 = 250;
const GATE_X = 430;
const OR_X = 640;
const FF_X = 980;

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

  const equations = analysis.equations;
  const sourceRows = buildSourceRows(analysis);
  const laneGap = 132;
  const laneStartY = snap(240);
  const logicHeight = laneStartY + equations.length * laneGap + 130;
  const sourceHeight = 168 + sourceRows.size * 42;
  const height = Math.max(760, logicHeight, sourceHeight + 150);
  const clockY = snap(height - 58);

  svg.innerHTML = "";
  svg.setAttribute("viewBox", `0 0 1220 ${height}`);
  stateLabelMap = new Map(analysis.variables.state.map((name, index) => [name, String.fromCharCode(65 + index)]));

  const root = createSvgElement("g", { id: "viewportRoot" });
  const wires = createSvgElement("g", { id: "wireLayer" });
  const components = createSvgElement("g", { id: "componentLayer" });
  const labels = createSvgElement("g", { id: "labelLayer" });
  const dots = createSvgElement("g", { id: "junctionLayer" });
  root.append(wires, components, labels, dots);
  svg.appendChild(root);

  drawEquationLegend({ wires, labels }, analysis.equations);
  drawSourceRails({ wires, components, labels, dots }, sourceRows, analysis);
  const ffMap = drawFlipFlops({ wires, components, labels, dots }, analysis, clockY);
  drawFeedbackWires({ wires, components, labels, dots }, sourceRows, analysis);
  drawEquations({ wires, components, labels, dots }, analysis, sourceRows, ffMap, laneStartY, laneGap);
  drawClock({ wires, labels, dots }, ffMap, clockY);

  applyView(svg);
}

function drawEquationLegend(ctx, equations) {
  text(ctx.labels, 72, 40, "Simplified Equations", "start", 16, false);
  equations.forEach((equation, index) => {
    const x = 72 + (index % 3) * 350;
    const y = 74 + Math.floor(index / 3) * 28;
    text(ctx.labels, x, y, `${formatEquationName(equation.name)} = ${formatExpression(equation.expression)}`, "start", 15, true);
  });
  line(ctx.wires, 56, 126, 1160, 126, "#d8e0ea", 1.2);
}

function drawSourceRails(ctx, sourceRows, analysis) {
  for (const source of sourceRows.values()) {
    line(ctx.wires, SOURCE_X0, source.y, SOURCE_X1, source.y);
    text(ctx.labels, SOURCE_X0 - 14, source.y, source.label, "end", 15, true);
  }

  drawInputInverterIfNeeded(ctx, sourceRows);
}

function drawInputInverterIfNeeded(ctx, sourceRows) {
  const normal = sourceRows.get("X");
  const inverted = sourceRows.get("X'");
  if (!normal || !inverted) return;

  const branchX = SOURCE_X0 + 54;
  const gateX = SOURCE_X0 + 82;
  polyline(ctx.wires, [
    [branchX, normal.y],
    [branchX, normal.y - 24],
    [gateX, normal.y - 24],
  ]);
  junction(ctx.dots, branchX, normal.y);
  const inv = notGate(ctx.components, gateX, normal.y - 40, 34, 32);
  polyline(ctx.wires, [
    [inv.outX, inv.outY],
    [inv.outX + 16, inv.outY],
    [inv.outX + 16, inverted.y],
    [SOURCE_X1, inverted.y],
  ]);
}

function drawFeedbackWires(ctx, sourceRows, analysis) {
  const ffPositions = flipFlopPositions(analysis);
  analysis.variables.state.forEach((qName, index) => {
    const stateSource = sourceRows.get(qName);
    const invertedSource = sourceRows.get(`${qName}'`);
    const ff = ffPositions.find((item) => item.name === qName);
    if (!ff) return;

    if (stateSource) {
      const trackY = snap(48 + index * TRACK);
      const trackX = snap(SOURCE_X0 + 12 + index * TRACK);
      polyline(ctx.wires, [
        [ff.x + ff.width, ff.y + 36],
        [1160, ff.y + 36],
        [1160, trackY],
        [trackX, trackY],
        [trackX, stateSource.y],
        [SOURCE_X1, stateSource.y],
      ]);
    }

    if (invertedSource) {
      const trackY = snap(72 + index * TRACK);
      const trackX = snap(SOURCE_X0 + 32 + index * TRACK);
      polyline(ctx.wires, [
        [ff.x + ff.width, ff.y + 72],
        [1176, ff.y + 72],
        [1176, trackY],
        [trackX, trackY],
        [trackX, invertedSource.y],
        [SOURCE_X1, invertedSource.y],
      ]);
    }
  });
}

function drawEquations(ctx, analysis, sourceRows, ffMap, laneStartY, laneGap) {
  analysis.equations.forEach((equation, laneIndex) => {
    const laneY = snap(laneStartY + laneIndex * laneGap);
    const output = drawExpressionNetwork(ctx, equation.expression, sourceRows, laneY, laneIndex);
    const target = getEquationTarget(equation, ffMap, laneY);
    routeOutputToTarget(ctx.wires, output, target, laneIndex);
    if (target.kind === "output") {
      text(ctx.labels, target.x + 14, target.y, "Z", "start", 16, true);
    }
  });
}

function drawExpressionNetwork(ctx, expression, sourceRows, laneY, laneIndex) {
  if (expression === "0" || expression === "1") {
    const constant = constantNode(ctx.components, ctx.labels, GATE_X, laneY - 16, expression);
    return { x: constant.outX, y: constant.outY };
  }

  const terms = splitTerms(expression);
  if (terms.length === 1) {
    return drawProductTerm(ctx, terms[0], sourceRows, laneY, laneIndex, 0);
  }

  const orGateHeight = Math.max(58, terms.length * 24 + 18);
  const or = orGate(ctx.components, OR_X, laneY - orGateHeight / 2, 96, orGateHeight, terms.length);
  terms.forEach((term, termIndex) => {
    const termY = snap(laneY - ((terms.length - 1) * 36) / 2 + termIndex * 36);
    const product = drawProductTerm(ctx, term, sourceRows, termY, laneIndex, termIndex);
    const input = or.inputs[termIndex];
    const routeX = snap(OR_X - 42 - termIndex * TRACK);
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
  const literals = parseLiterals(term);
  if (term === "1" || term === "0") {
    const constant = constantNode(ctx.components, ctx.labels, GATE_X, y - 16, term);
    return { x: constant.outX, y: constant.outY };
  }

  if (literals.length === 1) {
    const buffer = bufferGate(ctx.components, GATE_X, y - 18, 46, 36);
    routeLiteralToInput(ctx, literals[0], sourceRows, buffer.input, laneIndex, termIndex, 0);
    return { x: buffer.outX, y: buffer.outY };
  }

  const gateHeight = Math.max(44, literals.length * 18 + 16);
  const gate = andGate(ctx.components, GATE_X, y - gateHeight / 2, 74, gateHeight, literals.length);
  literals.forEach((literal, literalIndex) => {
    routeLiteralToInput(ctx, literal, sourceRows, gate.inputs[literalIndex], laneIndex, termIndex, literalIndex);
  });
  return { x: gate.outX, y: gate.outY };
}

function routeLiteralToInput(ctx, literal, sourceRows, input, laneIndex, termIndex, literalIndex) {
  const source = sourceRows.get(literal);
  if (!source) {
    throw new Error(`Diagram source missing for literal ${literal}.`);
  }

  const branchX = snap(138 + source.branchCount * TRACK);
  source.branchCount += 1;
  junction(ctx.dots, branchX, source.y);

  const approachY = snap(input.y + literalIndex * 2);
  polyline(ctx.wires, [
    [branchX, source.y],
    [branchX, approachY],
    [input.x, approachY],
    [input.x, input.y],
  ]);
}

function routeOutputToTarget(wires, output, target, laneIndex) {
  const trackX = target.kind === "ff" ? snap(FF_X - 72 - laneIndex * 6) : snap(910 + laneIndex * TRACK);
  polyline(wires, [
    [output.x, output.y],
    [trackX, output.y],
    [trackX, target.y],
    [target.x, target.y],
  ]);
}

function drawFlipFlops(ctx, analysis, clockY) {
  const positions = flipFlopPositions(analysis);
  const map = new Map();
  positions.forEach((ff) => {
    flipFlop(ctx, ff.x, ff.y, ff);
    map.set(ff.name, ff);
  });
  return map;
}

function drawClock(ctx, ffMap, clockY) {
  line(ctx.wires, SOURCE_X0, clockY, 1120, clockY);
  text(ctx.labels, SOURCE_X0 - 14, clockY, "CLK", "end", 15, true);
  text(ctx.labels, 1138, clockY, "CLK", "start", 15, true);

  for (const ff of ffMap.values()) {
    const x = ff.x + ff.width / 2;
    junction(ctx.dots, x, clockY);
    polyline(ctx.wires, [
      [x, clockY],
      [x, ff.y + ff.height],
    ]);
  }
}

function buildSourceRows(analysis) {
  const used = new Set();
  analysis.equations.forEach((equation) => {
    parseLiterals(equation.expression).forEach((literal) => used.add(literal));
  });
  used.add("X");
  analysis.variables.state.forEach((name) => used.add(name));

  const ordered = ["X", "X'", ...analysis.variables.state.flatMap((name) => [name, `${name}'`])].filter((name) =>
    used.has(name)
  );
  const rows = new Map();
  ordered.forEach((name, index) => {
    rows.set(name, {
      name,
      label: formatLiteral(name),
      y: snap(174 + index * 42),
      branchCount: 0,
    });
  });
  return rows;
}

function getEquationTarget(equation, ffMap, laneY) {
  if (equation.type === "output") {
    return { kind: "output", x: 1100, y: laneY };
  }

  const ffName = equation.name.match(/Q\d+$/)?.[0];
  const ff = ffMap.get(ffName);
  if (!ff) throw new Error(`Diagram target missing for ${equation.name}.`);

  if (equation.name.startsWith("K")) return { kind: "ff", x: ff.x, y: ff.y + 70 };
  if (equation.name.startsWith("T")) return { kind: "ff", x: ff.x, y: ff.y + 52 };
  return { kind: "ff", x: ff.x, y: ff.y + 34 };
}

function flipFlopPositions(analysis) {
  const startY = snap(166);
  return analysis.graph.flipFlops.map((ff, index) => ({
    ...ff,
    x: FF_X,
    y: startY + index * 178,
    width: 150,
    height: 108,
  }));
}

function flipFlop(ctx, x, y, ff) {
  rect(ctx.components, x, y, ff.width, ff.height, "#ffffff", WIRE, 1.8);
  const label = formatStateName(ff.name);
  const inputs = ff.type === "JK" ? [`J${label}`, `K${label}`] : [`T${label}`];
  inputs.forEach((name, index) => text(ctx.labels, x + 18, y + (ff.type === "JK" ? 34 + index * 36 : 52), name, "start", 14, true));
  text(ctx.labels, x + 102, y + 36, `Q${label}`, "start", 14, true);
  text(ctx.labels, x + 102, y + 72, `Q'${label}`, "start", 14, true);
  line(ctx.wires, x + ff.width, y + 36, x + ff.width + 42, y + 36);
  line(ctx.wires, x + ff.width, y + 72, x + ff.width + 42, y + 72);
  text(ctx.labels, x + ff.width + 52, y + 36, `Q${label}`, "start", 13, true);
  text(ctx.labels, x + ff.width + 52, y + 72, `Q'${label}`, "start", 13, true);
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
    x,
    y,
    width,
    height,
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
    x,
    y,
    width,
    height,
    inputs: inputPins(x + 5, y, height, inputCount),
    outX: x + width,
    outY: y + height / 2,
  };
}

function bufferGate(components, x, y, width, height) {
  path(components, `M ${x} ${y} L ${x} ${y + height} L ${x + width} ${y + height / 2} Z`, WIRE, "#ffffff", 1.6);
  return { input: { x, y: y + height / 2 }, outX: x + width, outY: y + height / 2 };
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

function formatEquationName(name) {
  return name.replace(/Q\d+/g, (qName) => stateLabelMap.get(qName) ?? qName);
}

function formatExpression(expression) {
  return expression.replace(/Q\d+/g, (qName) => stateLabelMap.get(qName) ?? qName).replace(/\s+/g, "");
}

function formatLiteral(literal) {
  const inverted = literal.endsWith("'");
  const base = inverted ? literal.slice(0, -1) : literal;
  const label = base.startsWith("Q") ? formatStateName(base) : base;
  return `${label}${inverted ? "'" : ""}`;
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
  root.appendChild(createSvgElement("line", { x1: snap(x1), y1: snap(y1), x2: snap(x2), y2: snap(y2), stroke, "stroke-width": width }));
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
