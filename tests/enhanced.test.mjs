import assert from "node:assert/strict";
import { analyzeCircuit, examples } from "../src/logic.js";
import { generateVerilog, simulateSequence } from "../src/enhancedTools.js";

for (const ffType of ["jk", "t", "sr", "d"]) {
  const analysis = analyzeCircuit(examples.mealyThreeOnes.rows, "mealy", ffType);
  const verilog = generateVerilog(analysis, analysis.rows, "mealy", ffType);

  assert.match(verilog, /module sequential_circuit_enhanced/);
  assert.match(verilog, /`default_nettype none/);
  assert.match(verilog, /output wire \[1:0\] state_bits/);
  assert.match(verilog, /localparam \[1:0\] S_A = 2'b00;/);
  assert.match(verilog, /always @\(\*\)/);
  assert.match(verilog, /always @\(posedge clk or posedge reset\)/);
  assert.doesNotMatch(verilog, /undefined/);
}

const rows = simulateSequence(examples.mealyThreeOnes.rows, "mealy", "111010111");
assert.equal(rows.length, 9);
assert.deepEqual(Object.keys(rows[0]), ["clock", "input", "presentState", "nextState", "output"]);
assert.equal(rows[0].presentState, "A");
assert.equal(rows.at(-1).nextState, "C");

console.log("enhanced tests passed");
