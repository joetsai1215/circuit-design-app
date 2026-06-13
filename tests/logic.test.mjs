import assert from "node:assert/strict";
import { analyzeCircuit, examples } from "../src/logic.js";

const mealyJk = analyzeCircuit(examples.mealyThreeOnes.rows, "mealy", "jk");
assert.deepEqual(
  Object.fromEntries(mealyJk.equations.map((equation) => [equation.name, equation.expression])),
  {
    JQ1: "Q0X",
    KQ1: "X'",
    JQ0: "Q1'X",
    KQ0: "1",
    Z: "Q1X",
  }
);

const mealyT = analyzeCircuit(examples.mealyThreeOnes.rows, "mealy", "t");
assert.deepEqual(
  Object.fromEntries(mealyT.equations.map((equation) => [equation.name, equation.expression])),
  {
    TQ1: "Q0X + Q1X'",
    TQ0: "Q0 + Q1'X",
    Z: "Q1X",
  }
);

const mooreJk = analyzeCircuit(examples.mooreThreeOnes.rows, "moore", "jk");
assert.deepEqual(
  Object.fromEntries(mooreJk.equations.map((equation) => [equation.name, equation.expression])),
  {
    JQ1: "Q0X",
    KQ1: "X'",
    JQ0: "X",
    KQ0: "Q1' + X'",
    Z: "Q1Q0",
  }
);

const textbookRows = [
  { state: "A", next0: "B", out0: "1", next1: "C", out1: "1" },
  { state: "B", next0: "A", out0: "1", next1: "B", out1: "0" },
  { state: "C", next0: "B", out0: "1", next1: "A", out1: "0" },
];
const textbookJk = analyzeCircuit(textbookRows, "mealy", "jk", {
  assignment: { A: "11", B: "10", C: "01" },
});
assert.deepEqual(
  Object.fromEntries(textbookJk.equations.map((equation) => [equation.name, equation.expression])),
  {
    JQ1: "1",
    KQ1: "Q0X",
    JQ0: "X'",
    KQ0: "X'",
    Z: "Q1Q0 + X'",
  }
);
assertEquationsReconstructStateTable(textbookRows, "mealy", "jk", {
  assignment: { A: "11", B: "10", C: "01" },
});

for (const model of ["mealy", "moore"]) {
  for (const ffType of ["jk", "t", "sr", "d"]) {
    const rows = model === "mealy" ? examples.mealyThreeOnes.rows : examples.mooreThreeOnes.rows;
    assertEquationsReconstructStateTable(rows, model, ffType);
  }
}

for (const stateCount of [1, 2, 3, 4, 5, 6]) {
  for (const model of ["mealy", "moore"]) {
    for (const ffType of ["jk", "t", "sr", "d"]) {
      for (let seed = 1; seed <= 40; seed += 1) {
        assertEquationsReconstructStateTable(makeRandomRows(stateCount, model, seed), model, ffType);
      }
    }
  }
}

console.log("logic tests passed");

function assertEquationsReconstructStateTable(rows, model, ffType, options = {}) {
  const analysis = analyzeCircuit(rows, model, ffType, options);
  const equations = Object.fromEntries(analysis.equations.map((equation) => [equation.name, equation.expression]));

  for (const transition of analysis.transitions) {
    const variables = { X: Number(transition.input) };
    analysis.variables.state.forEach((name, index) => {
      variables[name] = Number(transition.presentBits[index]);
    });

    assert.equal(
      evaluateExpression(equations.Z, variables),
      Number(transition.output),
      `Output mismatch for ${transition.presentState}, X=${transition.input}`
    );

    analysis.variables.state.forEach((name, index) => {
      const q = Number(transition.presentBits[index]);
      const expected = Number(transition.nextBits[index]);
      const actual =
        ffType === "jk"
          ? evaluateJkNextState(equations[`J${name}`], equations[`K${name}`], q, variables)
          : ffType === "t"
            ? q ^ evaluateExpression(equations[`T${name}`], variables)
            : ffType === "d"
              ? evaluateExpression(equations[`D${name}`], variables)
              : evaluateSrNextState(equations[`S${name}`], equations[`R${name}`], q, variables);

      assert.equal(
        actual,
        expected,
        `${ffType.toUpperCase()} ${name} mismatch for ${transition.presentState}, X=${transition.input}`
      );
    });
  }
}

function evaluateJkNextState(jExpression, kExpression, q, variables) {
  const j = evaluateExpression(jExpression, variables);
  const k = evaluateExpression(kExpression, variables);
  return (!q && j) || (q && !k) ? 1 : 0;
}

function evaluateSrNextState(sExpression, rExpression, q, variables) {
  const s = evaluateExpression(sExpression, variables);
  const r = evaluateExpression(rExpression, variables);
  assert.ok(!(s && r), "SR input cannot be S=1 and R=1 for a required transition.");
  if (s) return 1;
  if (r) return 0;
  return q;
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

function makeRandomRows(stateCount, model, seed) {
  let randomState = seed;
  const random = () => {
    randomState = (randomState * 1103515245 + 12345) >>> 0;
    return randomState / 2 ** 32;
  };
  const names = Array.from({ length: stateCount }, (_, index) => String.fromCharCode(65 + index));

  return names.map((name) => {
    const row = {
      state: name,
      next0: names[Math.floor(random() * stateCount)],
      next1: names[Math.floor(random() * stateCount)],
    };

    return model === "mealy"
      ? { ...row, out0: String(Math.floor(random() * 2)), out1: String(Math.floor(random() * 2)) }
      : { ...row, output: String(Math.floor(random() * 2)) };
  });
}
