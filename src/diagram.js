let view = { x: 0, y: 0, scale: 1 };
let drag = null;
let stateLabelMap = new Map();

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

  svg.innerHTML = "";
  svg.setAttribute("viewBox", "0 0 1180 760");
  stateLabelMap = new Map(analysis.variables.state.map((name, index) => [name, String.fromCharCode(65 + index)]));

  const defs = createSvgElement("defs");
  defs.innerHTML = `
    <marker id="dot" markerWidth="8" markerHeight="8" refX="4" refY="4">
      <circle cx="4" cy="4" r="3.5" fill="#253244"></circle>
    </marker>
  `;
  svg.appendChild(defs);

  const root = createSvgElement("g", { id: "viewportRoot" });
  svg.appendChild(root);

  drawInputRails(root, analysis);
  drawEquationLogic(root, analysis);
  drawFlipFlops(root, analysis);
  drawOutputLogic(root, analysis);
  drawClock(root);

  applyView(svg);
}

function drawInputRails(root, analysis) {
  const railColor = "#7b8da5";
  const rails = [
    { name: "X", y: 120 },
    { name: "X'", y: 168 },
    ...analysis.variables.state.map((name, index) => ({ name: formatStateName(name), y: 235 + index * 58 })),
  ];

  rails.forEach((rail) => {
    line(root, 58, rail.y, 1040, rail.y, railColor, 1.7);
    text(root, 44, rail.y, rail.name, "end", 16, true);
  });

  notGate(root, 118, 104);
  line(root, 58, 120, 118, 120, railColor, 1.7);
  line(root, 152, 120, 185, 120, railColor, 1.7);
  line(root, 185, 120, 185, 168, railColor, 1.7);
  nodeDot(root, 185, 168);
}

function drawEquationLogic(root, analysis) {
  const equations = analysis.graph.equations;
  const startY = 96;
  const rowGap = equations.length <= 3 ? 118 : 84;

  equations.forEach((equation, index) => {
    const y = startY + index * rowGap;
    const terms = splitTerms(equation.expression);
    const gate = terms.length > 1 ? orGate(root, 650, y) : andGate(root, 650, y + 8);
    text(root, 632, y - 30, `${formatEquationName(equation.name)} = ${formatExpression(equation.expression)}`, "middle", 16, true);

    drawTermInputs(root, terms, gate.x, y, index);
    const target = flipFlopInputPoint(equation.name, analysis);
    orthogonal(root, gate.outX, gate.outY, target.x, target.y);
  });
}

function drawFlipFlops(root, analysis) {
  const ffPositions = flipFlopPositions(analysis);
  ffPositions.forEach((ff) => {
    flipFlop(root, ff.x, ff.y, ff);
    line(root, ff.x + 140, ff.y + 42, 1100, ff.y + 42, "#7b8da5", 1.7);
    nodeDot(root, 1100, ff.y + 42);
    text(root, 1110, ff.y + 42, formatStateName(ff.name), "start", 16, true);
  });
}

function drawOutputLogic(root, analysis) {
  const outputEquation = analysis.graph.output;
  const terms = splitTerms(outputEquation.expression);
  const baseY = 565;
  const andOutputs = [];

  text(root, 628, baseY - 92, `Z = ${formatExpression(outputEquation.expression)}`, "middle", 17, true);

  terms.forEach((term, index) => {
    const y = baseY + index * 48;
    const gate = andGate(root, 492, y);
    drawLiteralFanIn(root, term, gate.x, gate.y, index + 8);
    andOutputs.push(gate);
  });

  const outputGate = terms.length > 1 ? orGate(root, 710, baseY + 45) : andGate(root, 710, baseY + 45);
  andOutputs.forEach((gate) => orthogonal(root, gate.outX, gate.outY, outputGate.x, outputGate.y + 18));
  line(root, outputGate.outX, outputGate.outY, 920, outputGate.outY, "#7b8da5", 1.8);
  text(root, 932, outputGate.outY, "Z", "start", 17, true);
}

function drawClock(root) {
  const y = 720;
  line(root, 58, y, 1090, y, "#7b8da5", 1.8);
  text(root, 42, y, "CLK", "end", 16, true);
  text(root, 1110, y, "CLK", "start", 16, true);
  nodeDot(root, 940, y);
}

function drawTermInputs(root, terms, targetX, targetY, offset) {
  if (terms.length === 1) {
    drawLiteralFanIn(root, terms[0], targetX, targetY + 8, offset);
    return;
  }

  terms.slice(0, 3).forEach((term, index) => {
    const mini = andGate(root, 430, targetY - 34 + index * 34, 44, 26);
    drawLiteralFanIn(root, term, mini.x, mini.y, offset + index);
    orthogonal(root, mini.outX, mini.outY, targetX, targetY + 10 + index * 12);
  });
}

function drawLiteralFanIn(root, term, targetX, targetY, offset) {
  const literals = parseLiterals(term);
  const rails = {
    X: 120,
    "X'": 168,
    B: 235,
    "B'": 235,
    A: 293,
    "A'": 293,
    Q1: 235,
    Q0: 293,
  };

  literals.slice(0, 3).forEach((literal, index) => {
    const y = rails[literal] ?? 120;
    const xBreak = 255 + offset * 12 + index * 22;
    line(root, xBreak, y, xBreak, targetY + index * 9, "#7b8da5", 1.4);
    line(root, xBreak, targetY + index * 9, targetX, targetY + index * 9, "#7b8da5", 1.4);
    nodeDot(root, xBreak, y);
  });
}

function flipFlop(root, x, y, ff) {
  rect(root, x, y, 140, 106, "#ffffff", "#7b8da5", 1.8);
  const inputNames = ff.type === "JK" ? [`J_${formatStateName(ff.name)}`, `K_${formatStateName(ff.name)}`] : [`T_${formatStateName(ff.name)}`];
  inputNames.forEach((name, index) => {
    text(root, x + 18, y + 34 + index * 34, name, "start", 15, true);
  });
  text(root, x + 100, y + 38, `Q_${formatStateName(ff.name)}`, "start", 15, true);
  text(root, x + 100, y + 72, `Q'_${formatStateName(ff.name)}`, "start", 15, true);
  path(root, `M ${x + 62} ${y + 106} L ${x + 72} ${y + 94} L ${x + 82} ${y + 106}`, "#7b8da5", "none", 1.6);
  text(root, x + 70, y + 116, "CLK", "middle", 11, false);
  line(root, 940, 720, x + 70, y + 106, "#7b8da5", 1.4);
}

function flipFlopPositions(analysis) {
  const startY = analysis.graph.flipFlops.length === 1 ? 292 : 245;
  return analysis.graph.flipFlops.map((ff, index) => ({
    ...ff,
    type: ff.type,
    x: 875,
    y: startY + index * 150,
  }));
}

function flipFlopInputPoint(equationName, analysis) {
  const ffName = equationName.match(/Q\d+$/)?.[0] ?? analysis.graph.flipFlops[0].name;
  const ff = flipFlopPositions(analysis).find((item) => item.name === ffName) ?? flipFlopPositions(analysis)[0];
  const isK = equationName.startsWith("K");
  const isT = equationName.startsWith("T");
  return { x: ff.x, y: ff.y + (isT ? 42 : isK ? 68 : 34) };
}

function splitTerms(expression) {
  if (expression === "0" || expression === "1") return [expression];
  return expression.split("+").map((term) => term.trim()).filter(Boolean);
}

function parseLiterals(term) {
  if (term === "0" || term === "1") return ["X"];
  return term.match(/Q\d+'?|X'?/g)?.map((literal) => formatExpression(literal).replaceAll(" ", "")) ?? ["X"];
}

function formatEquationName(name) {
  return name.replace(/Q\d+/g, (qName) => stateLabelMap.get(qName) ?? qName);
}

function formatExpression(expression) {
  return expression.replace(/Q\d+/g, (qName) => stateLabelMap.get(qName) ?? qName).replace(/\s+/g, "");
}

function formatStateName(name) {
  return stateLabelMap.get(name) ?? name;
}

function orGate(root, x, y, width = 92, height = 58) {
  const d = [
    `M ${x} ${y}`,
    `C ${x + 30} ${y + 10}, ${x + 30} ${y + height - 10}, ${x} ${y + height}`,
    `C ${x + 44} ${y + height - 8}, ${x + width - 22} ${y + height - 5}, ${x + width} ${y + height / 2}`,
    `C ${x + width - 22} ${y + 5}, ${x + 44} ${y + 8}, ${x} ${y}`,
  ].join(" ");
  path(root, d, "#7b8da5", "#ffffff", 1.8);
  return { x, y, outX: x + width, outY: y + height / 2 };
}

function andGate(root, x, y, width = 70, height = 42) {
  const d = [
    `M ${x} ${y}`,
    `L ${x + width / 2} ${y}`,
    `C ${x + width} ${y}, ${x + width} ${y + height}, ${x + width / 2} ${y + height}`,
    `L ${x} ${y + height}`,
    "Z",
  ].join(" ");
  path(root, d, "#7b8da5", "#ffffff", 1.7);
  return { x, y, outX: x + width, outY: y + height / 2 };
}

function notGate(root, x, y) {
  path(root, `M ${x} ${y} L ${x} ${y + 32} L ${x + 34} ${y + 16} Z`, "#7b8da5", "#ffffff", 1.7);
  circle(root, x + 40, y + 16, 4, "#ffffff", "#7b8da5", 1.5);
}

function orthogonal(root, x1, y1, x2, y2) {
  const mid = (x1 + x2) / 2;
  path(root, `M ${x1} ${y1} L ${mid} ${y1} L ${mid} ${y2} L ${x2} ${y2}`, "#7b8da5", "none", 1.6);
}

function line(root, x1, y1, x2, y2, stroke = "#7b8da5", width = 1.5) {
  const element = createSvgElement("line", { x1, y1, x2, y2, stroke, "stroke-width": width });
  root.appendChild(element);
}

function rect(root, x, y, width, height, fill, stroke, strokeWidth) {
  root.appendChild(createSvgElement("rect", { x, y, width, height, fill, stroke, "stroke-width": strokeWidth }));
}

function circle(root, cx, cy, r, fill, stroke, strokeWidth) {
  root.appendChild(createSvgElement("circle", { cx, cy, r, fill, stroke, "stroke-width": strokeWidth }));
}

function nodeDot(root, cx, cy) {
  circle(root, cx, cy, 3, "#253244", "#253244", 1);
}

function path(root, d, stroke, fill, strokeWidth) {
  const element = createSvgElement("path", {
    d,
    fill,
    stroke,
    "stroke-width": strokeWidth,
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
  });
  root.appendChild(element);
}

function text(root, x, y, value, anchor = "start", size = 14, italic = false) {
  const node = createSvgElement("text", {
    x,
    y,
    "text-anchor": anchor,
    "dominant-baseline": "middle",
    fill: "#253244",
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
