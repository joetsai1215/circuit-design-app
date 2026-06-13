import { analyzeCircuit, assignStates } from "./logic.js";

export function verifyEquations(rows, modelType, ffType, assignment) {
  const analysis = analyzeCircuit(rows, modelType, ffType, { assignment });
  const equations = Object.fromEntries(analysis.equations.map((equation) => [equation.name, equation.expression]));
  const checks = [];

  for (const transition of analysis.transitions) {
    const variables = makeVariableMap(analysis.variables.state, transition.presentBits, transition.input);
    const expectedOutput = Number(transition.output);
    const actualOutput = evaluateExpression(equations.Z, variables);

    checks.push({
      kind: "output",
      state: transition.presentState,
      input: transition.input,
      expected: String(expectedOutput),
      actual: String(actualOutput),
      pass: actualOutput === expectedOutput,
    });

    for (const [index, qName] of analysis.variables.state.entries()) {
      const q = Number(transition.presentBits[index]);
      const expectedNext = Number(transition.nextBits[index]);
      const actualNext = evaluateFlipFlopNext(ffType, qName, equations, q, variables);

      checks.push({
        kind: qName,
        state: transition.presentState,
        input: transition.input,
        expected: String(expectedNext),
        actual: String(actualNext),
        pass: actualNext === expectedNext,
      });
    }
  }

  return {
    analysis,
    pass: checks.every((check) => check.pass),
    checks,
  };
}

export function buildDerivation(analysis, ffType) {
  const equationMap = Object.fromEntries(analysis.equations.map((equation) => [equation.name, equation]));
  const binaryRows = analysis.transitions.map((transition) => ({
    presentState: transition.presentState,
    presentBits: transition.presentBits,
    input: transition.input,
    nextState: transition.nextState,
    nextBits: transition.nextBits,
    output: transition.output,
  }));

  const excitationRows = analysis.transitions.map((transition) => {
    const row = {
      presentState: transition.presentState,
      presentBits: transition.presentBits,
      input: transition.input,
      nextBits: transition.nextBits,
    };

    for (const [index, qName] of analysis.variables.state.entries()) {
      const q = transition.presentBits[index];
      const qNext = transition.nextBits[index];
      if (ffType === "jk") {
        row[`J${qName}`] = jkExcitation("J", q, qNext);
        row[`K${qName}`] = jkExcitation("K", q, qNext);
      } else if (ffType === "t") {
        row[`T${qName}`] = q === qNext ? "0" : "1";
      } else if (ffType === "sr") {
        row[`S${qName}`] = srExcitation("S", q, qNext);
        row[`R${qName}`] = srExcitation("R", q, qNext);
      } else if (ffType === "d") {
        row[`D${qName}`] = qNext;
      }
    }

    return row;
  });

  const truthTables = analysis.equations.map((equation) => ({
    name: equation.name,
    expression: equation.expression,
    rows: equation.truthRows.map((row) => ({ bits: row.bits, value: row.value })),
    kMap: analysis.kMaps[equation.name],
  }));

  return { binaryRows, excitationRows, truthTables, equationMap };
}

export function optimizeAssignments(rows, modelType, ffType, limit = 10) {
  const states = rows.map((row) => String(row.state ?? "").trim().toUpperCase()).filter(Boolean);
  const bitCount = Math.max(1, Math.ceil(Math.log2(states.length)));
  const codes = Array.from({ length: 2 ** bitCount }, (_, index) => index.toString(2).padStart(bitCount, "0"));

  if (states.length > 6) {
    throw new Error("Optimizer is limited to 6 states so it stays fast in the browser.");
  }

  const results = [];
  for (const selection of permutations(codes, states.length)) {
    const assignment = Object.fromEntries(states.map((state, index) => [state, selection[index]]));
    const analysis = analyzeCircuit(rows, modelType, ffType, { assignment });
    const score = scoreEquations(analysis.equations);
    results.push({ assignment, score, equations: analysis.equations });
  }

  return results
    .sort((a, b) => a.score.total - b.score.total || a.score.literals - b.score.literals || a.score.terms - b.score.terms)
    .slice(0, limit);
}

export function simulateSequence(rows, modelType, sequence) {
  const cleanRows = rows.map((row) => ({
    ...row,
    state: String(row.state ?? "").trim().toUpperCase(),
  }));
  const rowByState = new Map(cleanRows.map((row) => [row.state, row]));
  let currentState = cleanRows[0]?.state;
  const bits = sequence.replace(/[^01]/g, "").split("");

  return bits.map((input, clock) => {
    const row = rowByState.get(currentState);
    const nextState = input === "0" ? row.next0 : row.next1;
    const output = modelType === "mealy" ? (input === "0" ? row.out0 : row.out1) : row.output;
    const result = { clock, input, presentState: currentState, nextState, output };
    currentState = nextState;
    return result;
  });
}

export function generateVerilog(analysis, rows, modelType, ffType) {
  const stateNames = rows.map((row) => row.state);
  const stateWidth = analysis.variables.state.length;
  const stateParams = Object.entries(analysis.assignment)
    .map(([state, bits]) => `localparam [${stateWidth - 1}:0] S_${state} = ${stateWidth}'b${bits};`)
    .join("\n");
  const transitionCases = rows
    .map((row) => {
      const output0 = modelType === "mealy" ? row.out0 : row.output;
      const output1 = modelType === "mealy" ? row.out1 : row.output;
      return [
        `      S_${row.state}: begin`,
        `        if (X == 1'b0) begin next_state = S_${row.next0}; Z = 1'b${output0}; end`,
        `        else begin next_state = S_${row.next1}; Z = 1'b${output1}; end`,
        "      end",
      ].join("\n");
    })
    .join("\n");
  const equationLines = analysis.equations
    .map((equation) => `// ${equation.name} = ${equation.expression}`)
    .join("\n");

  return `module sequential_circuit_enhanced(
  input wire clk,
  input wire reset,
  input wire X,
  output reg Z
);

${stateParams}

reg [${stateWidth - 1}:0] state, next_state;

${equationLines}

always @(*) begin
  next_state = state;
  Z = 1'b0;
  case (state)
${transitionCases}
      default: begin next_state = S_${stateNames[0]}; Z = 1'b0; end
  endcase
end

always @(posedge clk or posedge reset) begin
  if (reset) state <= S_${stateNames[0]};
  else state <= next_state;
end

endmodule`;
}

export function makeDefaultAssignment(rows) {
  return assignStates(rows.map((row) => ({ state: String(row.state ?? "").trim().toUpperCase() })).filter((row) => row.state));
}

export function toHorizontalKMap(kmap) {
  const lookup = new Map(kmap.cells.map((cell) => [cell.bits, cell.value]));
  const columnVariables = parseVariableNames(kmap.columnVariables);

  if (kmap.rowVariable && columnVariables.length === 2) {
    const stateRows = ["00", "01", "11", "10"];
    const inputColumns = ["0", "1"];
    return {
      rowVariables: `${kmap.rowVariable}${columnVariables[0]}`,
      columnVariable: columnVariables[1],
      rowLabels: stateRows,
      columnLabels: inputColumns,
      cells: stateRows.flatMap((stateBits) =>
        inputColumns.map((inputBit) => ({
          bits: `${stateBits}${inputBit}`,
          value: lookup.get(`${stateBits}${inputBit}`) ?? "0",
        }))
      ),
    };
  }

  return {
    rowVariables: kmap.rowVariable,
    columnVariable: kmap.columnVariables,
    rowLabels: kmap.rowLabels,
    columnLabels: kmap.columnLabels,
    cells: kmap.cells,
  };
}

function evaluateJkNext(jExpression, kExpression, q, variables) {
  const j = evaluateExpression(jExpression, variables);
  const k = evaluateExpression(kExpression, variables);
  return (!q && j) || (q && !k) ? 1 : 0;
}

function evaluateFlipFlopNext(ffType, qName, equations, q, variables) {
  if (ffType === "jk") {
    return evaluateJkNext(equations[`J${qName}`], equations[`K${qName}`], q, variables);
  }

  if (ffType === "t") {
    return q ^ evaluateExpression(equations[`T${qName}`], variables);
  }

  if (ffType === "d") {
    return evaluateExpression(equations[`D${qName}`], variables);
  }

  if (ffType === "sr") {
    const s = evaluateExpression(equations[`S${qName}`], variables);
    const r = evaluateExpression(equations[`R${qName}`], variables);
    if (s && r) return Number.NaN;
    if (s) return 1;
    if (r) return 0;
    return q;
  }

  throw new Error(`Unsupported flip-flop type: ${ffType}`);
}

function evaluateExpression(expression, variables) {
  if (expression === "0") return 0;
  if (expression === "1") return 1;

  return expression.split("+").some((term) => {
    const factors = term.trim().match(/Q\d+'?|X'?/g) ?? [];
    return factors.every((factor) => {
      const inverted = factor.endsWith("'");
      const name = inverted ? factor.slice(0, -1) : factor;
      return inverted ? variables[name] === 0 : variables[name] === 1;
    });
  })
    ? 1
    : 0;
}

function makeVariableMap(stateVariables, presentBits, input) {
  const variables = { X: Number(input) };
  stateVariables.forEach((name, index) => {
    variables[name] = Number(presentBits[index]);
  });
  return variables;
}

function jkExcitation(inputName, q, qNext) {
  if (inputName === "J") {
    if (q === "0" && qNext === "0") return "0";
    if (q === "0" && qNext === "1") return "1";
    return "X";
  }

  if (q === "1" && qNext === "0") return "1";
  if (q === "1" && qNext === "1") return "0";
  return "X";
}

function srExcitation(inputName, q, qNext) {
  if (q === "0" && qNext === "0") return inputName === "S" ? "0" : "X";
  if (q === "0" && qNext === "1") return inputName === "S" ? "1" : "0";
  if (q === "1" && qNext === "0") return inputName === "S" ? "0" : "1";
  return inputName === "S" ? "X" : "0";
}

function scoreEquations(equations) {
  const parts = equations.map((equation) => expressionCost(equation.expression));
  const terms = parts.reduce((sum, part) => sum + part.terms, 0);
  const literals = parts.reduce((sum, part) => sum + part.literals, 0);
  const inversions = parts.reduce((sum, part) => sum + part.inversions, 0);
  return {
    terms,
    literals,
    inversions,
    total: literals + terms * 2 + inversions,
  };
}

function expressionCost(expression) {
  if (expression === "0" || expression === "1") {
    return { terms: 0, literals: 0, inversions: 0 };
  }

  const terms = expression.split("+").map((term) => term.trim()).filter(Boolean);
  const literals = terms.reduce((sum, term) => sum + (term.match(/Q\d+'?|X'?/g) ?? []).length, 0);
  const inversions = terms.reduce((sum, term) => sum + (term.match(/'/g) ?? []).length, 0);
  return { terms: terms.length, literals, inversions };
}

function* permutations(items, length, prefix = []) {
  if (prefix.length === length) {
    yield prefix;
    return;
  }

  for (const item of items) {
    if (prefix.includes(item)) continue;
    yield* permutations(items, length, [...prefix, item]);
  }
}

function parseVariableNames(text) {
  return String(text ?? "").match(/Q\d+|X/g) ?? [];
}
