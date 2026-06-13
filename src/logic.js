const grayColumns = ["00", "01", "11", "10"];

export const examples = {
  mealyThreeOnes: {
    modelType: "mealy",
    rows: [
      { state: "A", next0: "A", out0: "0", next1: "B", out1: "0" },
      { state: "B", next0: "A", out0: "0", next1: "C", out1: "0" },
      { state: "C", next0: "A", out0: "0", next1: "C", out1: "1" },
    ],
  },
  mooreThreeOnes: {
    modelType: "moore",
    rows: [
      { state: "A", output: "0", next0: "A", next1: "B" },
      { state: "B", output: "0", next0: "A", next1: "C" },
      { state: "C", output: "0", next0: "A", next1: "D" },
      { state: "D", output: "1", next0: "A", next1: "D" },
    ],
  },
};

export function parseDescriptionToTable(text, modelType) {
  const normalized = text.toLowerCase();
  const mentionsThreeConsecutiveOnes =
    normalized.includes("three") && normalized.includes("consecutive") && normalized.includes("1");

  if (mentionsThreeConsecutiveOnes) {
    return modelType === "moore" ? examples.mooreThreeOnes.rows : examples.mealyThreeOnes.rows;
  }

  throw new Error("This local parser currently recognizes the three-consecutive-1s example. Connect the LLM parser for open-ended text.");
}

export function normalizeRows(rawRows, modelType) {
  const rows = rawRows
    .map((row) => ({
      state: cleanToken(row.state).toUpperCase(),
      next0: cleanToken(row.next0).toUpperCase(),
      next1: cleanToken(row.next1).toUpperCase(),
      out0: cleanBit(row.out0),
      out1: cleanBit(row.out1),
      output: cleanBit(row.output),
    }))
    .filter((row) => row.state);

  const stateNames = rows.map((row) => row.state);
  const stateSet = new Set(stateNames);

  if (rows.length === 0) {
    throw new Error("State table is empty.");
  }

  for (const row of rows) {
    if (!row.next0 || !row.next1) {
      throw new Error(`State ${row.state} is missing next-state data.`);
    }
    if (!stateSet.has(row.next0) || !stateSet.has(row.next1)) {
      throw new Error(`State ${row.state} references a next state that is not in the table.`);
    }
    if (modelType === "mealy" && (!isBit(row.out0) || !isBit(row.out1))) {
      throw new Error(`State ${row.state} has invalid Mealy output. Use 0 or 1.`);
    }
    if (modelType === "moore" && !isBit(row.output)) {
      throw new Error(`State ${row.state} has invalid Moore output. Use 0 or 1.`);
    }
  }

  return rows;
}

export function assignStates(rows) {
  const bitCount = Math.max(1, Math.ceil(Math.log2(rows.length)));
  return Object.fromEntries(
    rows.map((row, index) => [row.state, index.toString(2).padStart(bitCount, "0")])
  );
}

export function analyzeCircuit(rows, modelType, ffType, options = {}) {
  const normalizedRows = normalizeRows(rows, modelType);
  const assignment = normalizeAssignment(normalizedRows, options.assignment);
  const stateBits = Object.values(assignment)[0].length;
  const variables = buildVariables(stateBits);
  const transitions = expandTransitions(normalizedRows, modelType, assignment);
  const unusedRows = buildUnusedRows(assignment, stateBits);
  const equations = [];

  for (let bit = 0; bit < stateBits; bit += 1) {
    const bitName = variables.state[bit];
    const excitation = buildExcitationFunction(bit, bitName, ffType, transitions, unusedRows, variables);
    equations.push(...excitation);
  }

  equations.push(buildOutputFunction(modelType, normalizedRows, transitions, unusedRows, assignment, variables));

  return {
    rows: normalizedRows,
    assignment,
    variables,
    transitions,
    equations,
    kMaps: Object.fromEntries(equations.map((equation) => [equation.name, buildKMap(equation, variables.ordered)])),
    graph: buildCircuitGraph(equations, variables, ffType),
  };
}

function normalizeAssignment(rows, customAssignment) {
  if (!customAssignment) return assignStates(rows);

  const stateNames = rows.map((row) => row.state);
  const values = stateNames.map((state) => cleanToken(customAssignment[state]));
  const bitLength = values[0]?.length;

  if (!bitLength) {
    throw new Error("State assignment is missing.");
  }

  const minimumBits = Math.max(1, Math.ceil(Math.log2(rows.length)));
  if (bitLength < minimumBits) {
    throw new Error(`State assignment needs at least ${minimumBits} bit(s).`);
  }

  const seen = new Set();
  const assignment = {};

  stateNames.forEach((state, index) => {
    const bits = values[index];
    if (!/^[01]+$/.test(bits)) {
      throw new Error(`State ${state} has invalid assignment. Use only 0 and 1.`);
    }
    if (bits.length !== bitLength) {
      throw new Error("All state assignments must have the same number of bits.");
    }
    if (seen.has(bits)) {
      throw new Error(`Duplicate state assignment: ${bits}.`);
    }
    seen.add(bits);
    assignment[state] = bits;
  });

  return assignment;
}

function expandTransitions(rows, modelType, assignment) {
  const transitions = [];

  for (const row of rows) {
    for (const input of ["0", "1"]) {
      transitions.push({
        presentState: row.state,
        input,
        nextState: input === "0" ? row.next0 : row.next1,
        output: modelType === "mealy" ? (input === "0" ? row.out0 : row.out1) : row.output,
        presentBits: assignment[row.state],
        nextBits: assignment[input === "0" ? row.next0 : row.next1],
      });
    }
  }

  return transitions;
}

function buildVariables(stateBits) {
  const state = Array.from({ length: stateBits }, (_, index) => `Q${stateBits - 1 - index}`);
  return { ordered: [...state, "X"], state, input: "X" };
}

function buildExcitationFunction(bitIndex, bitName, ffType, transitions, unusedRows, variables) {
  const outputs = excitationOutputs(ffType, bitName);

  return outputs.map((name) => {
    const truthRows = [
      ...transitions.map((transition) => {
        const q = transition.presentBits[bitIndex];
        const qNext = transition.nextBits[bitIndex];
        return {
          bits: `${transition.presentBits}${transition.input}`,
          value: excitationValue(ffType, name[0], q, qNext),
          context: transition,
        };
      }),
      ...unusedRows,
    ];

    return {
      name,
      type: "ff-input",
      variables: variables.ordered,
      truthRows,
      expression: simplifySop(truthRows, variables.ordered),
    };
  });
}

function excitationOutputs(ffType, bitName) {
  if (ffType === "jk") return [`J${bitName}`, `K${bitName}`];
  if (ffType === "t") return [`T${bitName}`];
  if (ffType === "sr") return [`S${bitName}`, `R${bitName}`];
  if (ffType === "d") return [`D${bitName}`];
  throw new Error(`Unsupported flip-flop type: ${ffType}`);
}

function excitationValue(ffType, inputName, q, qNext) {
  if (ffType === "d") {
    return qNext;
  }

  if (ffType === "t") {
    return q === qNext ? "0" : "1";
  }

  if (ffType === "sr") {
    if (q === "0" && qNext === "0") return inputName === "S" ? "0" : "X";
    if (q === "0" && qNext === "1") return inputName === "S" ? "1" : "0";
    if (q === "1" && qNext === "0") return inputName === "S" ? "0" : "1";
    return inputName === "S" ? "X" : "0";
  }

  if (inputName === "J") {
    if (q === "0" && qNext === "0") return "0";
    if (q === "0" && qNext === "1") return "1";
    return "X";
  }

  if (q === "1" && qNext === "0") return "1";
  if (q === "1" && qNext === "1") return "0";
  return "X";
}

function buildOutputFunction(modelType, rows, transitions, unusedRows, assignment, variables) {
  const truthRows =
    modelType === "mealy"
      ? [
          ...transitions.map((transition) => ({
            bits: `${transition.presentBits}${transition.input}`,
            value: transition.output,
            context: transition,
          })),
          ...unusedRows,
        ]
      : [
          ...rows.flatMap((row) =>
            ["0", "1"].map((input) => ({
              bits: `${assignment[row.state]}${input}`,
              value: row.output,
              context: row,
            }))
          ),
          ...unusedRows,
        ];

  return {
    name: "Z",
    type: "output",
    variables: variables.ordered,
    truthRows,
    expression: simplifySop(truthRows, variables.ordered),
  };
}

export function simplifySop(truthRows, variables) {
  const ones = truthRows.filter((row) => row.value === "1").map((row) => row.bits);
  const dcs = truthRows.filter((row) => row.value === "X").map((row) => row.bits);

  if (ones.length === 0) return "0";

  const candidates = generateImplicants([...ones, ...dcs]);
  const validCandidates = candidates
    .map((pattern) => ({
      pattern,
      coveredOnes: ones.filter((bits) => covers(pattern, bits)),
      size: countCovered(pattern),
    }))
    .filter((candidate) => candidate.coveredOnes.length > 0);

  const selected = chooseMinimalCover(ones, validCandidates);
  if (selected.length === 0) return "0";

  if (selected.some((item) => item.pattern.every((char) => char === "-"))) return "1";

  return selected
    .sort((a, b) => termToText(a.pattern, variables).localeCompare(termToText(b.pattern, variables)))
    .map((item) => termToText(item.pattern, variables))
    .join(" + ");
}

function generateImplicants(bitsList) {
  const bitCount = bitsList[0]?.length ?? 0;
  const patterns = new Set();
  const totalPatterns = 3 ** bitCount;

  for (let mask = 0; mask < totalPatterns; mask += 1) {
    const pattern = [];
    let current = mask;
    for (let bit = 0; bit < bitCount; bit += 1) {
      pattern.push(["0", "1", "-"][current % 3]);
      current = Math.floor(current / 3);
    }
    const covered = bitsList.filter((bits) => covers(pattern, bits));
    if (covered.length > 0 && covered.length === countCovered(pattern)) {
      patterns.add(pattern.join(""));
    }
  }

  return [...patterns].map((pattern) => pattern.split(""));
}

function chooseMinimalCover(ones, candidates) {
  const sorted = candidates.sort((a, b) => b.size - a.size || literalCount(a.pattern) - literalCount(b.pattern));
  let best = null;

  function search(index, covered, selected) {
    if (best && selected.length > best.length) return;
    if (ones.every((one) => covered.has(one))) {
      if (!best || isBetterCover(selected, best)) {
        best = [...selected];
      }
      return;
    }
    if (index >= sorted.length) return;

    const next = sorted[index];
    const withCovered = new Set(covered);
    next.coveredOnes.forEach((one) => withCovered.add(one));
    search(index + 1, withCovered, [...selected, next]);
    search(index + 1, covered, selected);
  }

  search(0, new Set(), []);
  return best ?? [];
}

function isBetterCover(candidate, current) {
  if (candidate.length !== current.length) return candidate.length < current.length;
  const candidateLiterals = candidate.reduce((sum, item) => sum + literalCount(item.pattern), 0);
  const currentLiterals = current.reduce((sum, item) => sum + literalCount(item.pattern), 0);
  return candidateLiterals < currentLiterals;
}

function termToText(pattern, variables) {
  const parts = pattern
    .map((value, index) => {
      if (value === "-") return null;
      return value === "1" ? variables[index] : `${variables[index]}'`;
    })
    .filter(Boolean);

  return parts.length === 0 ? "1" : parts.join("");
}

function buildKMap(equation, variables) {
  const rowLabels = variables.length === 2 ? ["0", "1"] : ["0", "1"];
  const columnLabels = variables.length === 2 ? ["0", "1"] : grayColumns;
  const cells = [];

  for (const rowLabel of rowLabels) {
    for (const columnLabel of columnLabels) {
      const bits = variables.length === 2 ? `${rowLabel}${columnLabel}` : `${rowLabel}${columnLabel}`;
      const truth = equation.truthRows.find((entry) => entry.bits === bits);
      cells.push({ bits, value: truth?.value ?? "0" });
    }
  }

  return {
    rowVariable: variables[0],
    columnVariables: variables.slice(1).join(""),
    rowLabels,
    columnLabels,
    cells,
    expression: equation.expression,
  };
}

function buildUnusedRows(assignment, stateBits) {
  const used = new Set(Object.values(assignment));
  const rows = [];
  for (let index = 0; index < 2 ** stateBits; index += 1) {
    const bits = index.toString(2).padStart(stateBits, "0");
    if (used.has(bits)) continue;
    for (const input of ["0", "1"]) {
      rows.push({ bits: `${bits}${input}`, value: "X", context: null });
    }
  }
  return rows;
}

function buildCircuitGraph(equations, variables, ffType) {
  return {
    inputs: variables.ordered,
    flipFlops: variables.state.map((name) => ({ name, type: ffType.toUpperCase() })),
    equations: equations.filter((equation) => equation.type === "ff-input"),
    output: equations.find((equation) => equation.name === "Z"),
  };
}

function cleanToken(value) {
  return String(value ?? "").trim();
}

function cleanBit(value) {
  const bit = cleanToken(value).toUpperCase();
  return bit === "X" ? "X" : bit;
}

function isBit(value) {
  return value === "0" || value === "1";
}

function covers(pattern, bits) {
  return pattern.every((char, index) => char === "-" || char === bits[index]);
}

function countCovered(pattern) {
  return 2 ** pattern.filter((char) => char === "-").length;
}

function literalCount(pattern) {
  return pattern.filter((char) => char !== "-").length;
}
