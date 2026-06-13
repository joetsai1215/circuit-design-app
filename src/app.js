import { analyzeCircuit, assignStates, examples, parseDescriptionToTable } from "./logic.js";
import { bindDiagramPan, renderCircuitDiagram, resetDiagramView, zoomDiagram } from "./diagram.js";
import {
  buildDerivation,
  generateVerilog,
  optimizeAssignments,
  simulateSequence,
  toHorizontalKMap,
  verifyEquations,
} from "./enhancedTools.js";
import { parseStateTableWithOpenAI } from "./openaiParser.js";

const state = {
  modelType: "mealy",
  ffType: "jk",
  rows: structuredClone(examples.mealyThreeOnes.rows),
  assignment: {},
  analysis: null,
  waveform: {
    type: "sine",
    frequency: 5,
    amplitude: 1,
    phase: Math.PI,
    time: 0,
    playing: false,
    lastTimestamp: null,
    animationId: null,
  },
};

const els = {
  statusText: document.querySelector("#statusText"),
  modelBadge: document.querySelector("#modelBadge"),
  ffBadge: document.querySelector("#ffBadge"),
  modelHint: document.querySelector("#modelHint"),
  stateTableHead: document.querySelector("#stateTableHead"),
  stateTableBody: document.querySelector("#stateTableBody"),
  assignmentTable: document.querySelector("#assignmentTable"),
  equationList: document.querySelector("#equationList"),
  equationSelect: document.querySelector("#equationSelect"),
  kmapView: document.querySelector("#kmapView"),
  circuitSvg: document.querySelector("#circuitSvg"),
  problemText: document.querySelector("#problemText"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  apiModelInput: document.querySelector("#apiModelInput"),
  enhancedVerificationView: document.querySelector("#enhancedVerificationView"),
  enhancedOptimizerView: document.querySelector("#enhancedOptimizerView"),
  enhancedDerivationView: document.querySelector("#enhancedDerivationView"),
  sequenceInput: document.querySelector("#sequenceInput"),
  sequenceSimulationView: document.querySelector("#sequenceSimulationView"),
  verilogOutput: document.querySelector("#verilogOutput"),
  waveformCanvas: document.querySelector("#waveformCanvas"),
  mathExpression: document.querySelector("#mathExpression"),
  summaryPanel: document.querySelector("#summaryPanel"),
  frequencySlider: document.querySelector("#frequencySlider"),
  frequencyInput: document.querySelector("#frequencyInput"),
  frequencyLabel: document.querySelector("#frequencyLabel"),
  amplitudeSlider: document.querySelector("#amplitudeSlider"),
  amplitudeInput: document.querySelector("#amplitudeInput"),
  amplitudeLabel: document.querySelector("#amplitudeLabel"),
  phaseSlider: document.querySelector("#phaseSlider"),
  phaseInput: document.querySelector("#phaseInput"),
  phaseLabel: document.querySelector("#phaseLabel"),
  waveReset: document.querySelector("#waveReset"),
  wavePlay: document.querySelector("#wavePlay"),
  wavePause: document.querySelector("#wavePause"),
};

init();

function init() {
  document.querySelectorAll("[name='modelType']").forEach((input) => {
    input.addEventListener("change", () => {
      state.modelType = input.value;
      state.rows = structuredClone(state.modelType === "moore" ? examples.mooreThreeOnes.rows : examples.mealyThreeOnes.rows);
      resetAssignmentFromRows();
      renderBadges();
      renderStateTable();
      clearResults("Model changed. Example table loaded.");
    });
  });

  document.querySelectorAll("[name='ffType']").forEach((input) => {
    input.addEventListener("change", () => {
      state.ffType = input.value;
      renderBadges();
      clearResults("Flip-flop type changed.");
    });
  });

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  document.querySelector("#clearTableButton").addEventListener("click", () => {
    state.rows = [];
    state.assignment = {};
    renderStateTable();
    clearResults("Table cleared.");
  });

  document.querySelector("#loadExampleButton").addEventListener("click", () => {
    state.rows = structuredClone(state.modelType === "moore" ? examples.mooreThreeOnes.rows : examples.mealyThreeOnes.rows);
    resetAssignmentFromRows();
    renderStateTable();
    clearResults("Example loaded.");
  });

  document.querySelector("#addStateButton").addEventListener("click", () => {
    const nextName = String.fromCharCode(65 + state.rows.length);
    state.rows.push(
      state.modelType === "mealy"
        ? { state: nextName, next0: nextName, out0: "0", next1: nextName, out1: "0" }
        : { state: nextName, output: "0", next0: nextName, next1: nextName }
    );
    syncAssignmentFromRows();
    renderStateTable();
    clearResults("State added.");
  });

  document.querySelector("#parseTextButton").addEventListener("click", () => {
    parseTextDescription();
  });

  document.querySelector("#saveApiKeyButton").addEventListener("click", () => {
    const key = els.apiKeyInput.value.trim();
    if (!key) {
      setStatus("Enter an API key before saving.", true);
      return;
    }
    localStorage.setItem("scdas_openai_api_key", key);
    localStorage.setItem("scdas_openai_model", els.apiModelInput.value.trim() || "gpt-4o-mini");
    setStatus("API key saved locally.");
  });

  document.querySelector("#clearApiKeyButton").addEventListener("click", () => {
    localStorage.removeItem("scdas_openai_api_key");
    localStorage.removeItem("scdas_openai_model");
    els.apiKeyInput.value = "";
    els.apiModelInput.value = "gpt-4o-mini";
    setStatus("API key cleared.");
  });

  document.querySelector("#generateButton").addEventListener("click", generateCircuit);
  document.querySelector("#verifyEquationButton").addEventListener("click", runEnhancedVerification);
  document.querySelector("#optimizeAssignmentButton").addEventListener("click", runAssignmentOptimizer);
  document.querySelector("#simulateSequenceButton").addEventListener("click", renderSequenceSimulation);
  els.equationSelect.addEventListener("change", renderSelectedKMap);

  document.querySelector("#zoomOutButton").addEventListener("click", () => zoomDiagram(els.circuitSvg, -0.15));
  document.querySelector("#zoomInButton").addEventListener("click", () => zoomDiagram(els.circuitSvg, 0.15));
  document.querySelector("#zoomResetButton").addEventListener("click", () => {
    resetDiagramView();
    renderCircuitDiagram(els.circuitSvg, state.analysis);
  });

  bindDiagramPan(els.circuitSvg);
  initWaveformControls();
  loadApiSettings();
  resetAssignmentFromRows();
  renderBadges();
  renderStateTable();
  renderEmptyResults();
  renderWaveform();
}

function loadApiSettings() {
  els.apiKeyInput.value = localStorage.getItem("scdas_openai_api_key") ?? "";
  els.apiModelInput.value = localStorage.getItem("scdas_openai_model") ?? "gpt-4o-mini";
}

function renderBadges() {
  els.modelBadge.textContent = state.modelType === "mealy" ? "MEALY Model" : "MOORE Model";
  els.ffBadge.textContent =
    {
      jk: "JK Flip-Flop",
      t: "T Flip-Flop",
      sr: "SR Flip-Flop",
      d: "D Flip-Flop",
    }[state.ffType] ?? "JK Flip-Flop";
  els.modelHint.textContent =
    state.modelType === "mealy"
      ? "Mealy: output depends on present state and input."
      : "Moore: output depends only on the present state.";
}

function switchTab(tabName) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  document.querySelector("#textPane").classList.toggle("active", tabName === "text");
  document.querySelector("#manualPane").classList.toggle("active", tabName === "manual");
}

function renderStateTable() {
  const isMealy = state.modelType === "mealy";
  const columns = isMealy
    ? [
        ["state", "Present State"],
        ["next0", "Next State X=0"],
        ["out0", "Output X=0"],
        ["next1", "Next State X=1"],
        ["out1", "Output X=1"],
      ]
    : [
        ["state", "Present State"],
        ["output", "State Output"],
        ["next0", "Next State X=0"],
        ["next1", "Next State X=1"],
      ];

  els.stateTableHead.innerHTML = `<tr>${columns.map(([, label]) => `<th>${label}</th>`).join("")}</tr>`;
  els.stateTableBody.innerHTML = state.rows
    .map(
      (row, rowIndex) =>
        `<tr>${columns
          .map(
            ([key]) =>
              `<td><input data-row="${rowIndex}" data-key="${key}" value="${escapeHtml(row[key] ?? "")}" aria-label="${key} row ${rowIndex + 1}" /></td>`
          )
          .join("")}</tr>`
    )
    .join("");

  els.stateTableBody.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      const rowIndex = Number(input.dataset.row);
      state.rows[rowIndex][input.dataset.key] = input.value;
      if (input.dataset.key === "state") {
        syncAssignmentFromRows();
        renderAssignmentEditor();
      }
      clearResults("Table edited.");
    });
  });

  renderAssignmentEditor();
}

function generateCircuit() {
  try {
    state.analysis = analyzeCircuit(readRowsFromTable(), state.modelType, state.ffType, {
      assignment: readAssignmentFromEditor(),
    });
    state.rows = state.analysis.rows;
    state.assignment = state.analysis.assignment;
    renderAnalysis();
    renderEnhancedTools();
    setStatus("Circuit generated.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function parseTextDescription() {
  const problemText = els.problemText.value.trim();
  const apiKey = els.apiKeyInput.value.trim();
  const model = els.apiModelInput.value.trim() || "gpt-4o-mini";

  if (!problemText) {
    setStatus("Enter a problem description first.", true);
    return;
  }

  if (!apiKey) {
    try {
      state.rows = parseDescriptionToTable(problemText, state.modelType);
      resetAssignmentFromRows();
      renderStateTable();
      clearResults("Parsed by local example parser. Add an API key for open-ended AI parsing.");
    } catch (error) {
      setStatus("Enter an OpenAI API key to parse open-ended descriptions.", true);
    }
    return;
  }

  setStatus("AI parsing...");
  document.querySelector("#parseTextButton").disabled = true;

  try {
    const result = await parseStateTableWithOpenAI({
      apiKey,
      model,
      problemText,
      modelType: state.modelType,
    });
    state.rows = result.rows;
    resetAssignmentFromRows();
    renderStateTable();
    clearResults(result.notes ? `AI parsed: ${result.notes}` : "AI parsed state table.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    document.querySelector("#parseTextButton").disabled = false;
  }
}

function resetAssignmentFromRows() {
  state.assignment = autoAssignmentFromRows();
}

function syncAssignmentFromRows() {
  const auto = autoAssignmentFromRows();
  state.assignment = Object.fromEntries(
    Object.entries(auto).map(([stateName, bits]) => [stateName, state.assignment[stateName] ?? bits])
  );
}

function autoAssignmentFromRows() {
  const rows = state.rows
    .map((row) => ({ state: String(row.state ?? "").trim().toUpperCase() }))
    .filter((row) => row.state);
  return rows.length ? assignStates(rows) : {};
}

function renderAssignmentEditor() {
  syncAssignmentFromRows();
  const entries = Object.entries(state.assignment);

  if (!entries.length) {
    els.assignmentTable.innerHTML = '<span class="placeholder">Assignments appear after states are entered.</span>';
    return;
  }

  els.assignmentTable.innerHTML = `
    ${entries
      .map(
        ([stateName, bits]) => `
          <label class="assignment-row">
            <span>${stateName}</span>
            <input data-assignment-state="${stateName}" value="${escapeHtml(bits)}" inputmode="numeric" />
          </label>
        `
      )
      .join("")}
    <button class="secondary-button assignment-auto-button" id="autoAssignButton" type="button">Auto Assign</button>
  `;

  els.assignmentTable.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      state.assignment[input.dataset.assignmentState] = input.value.trim();
      clearResults("State assignment edited.");
    });
  });

  els.assignmentTable.querySelector("#autoAssignButton").addEventListener("click", () => {
    resetAssignmentFromRows();
    renderAssignmentEditor();
    clearResults("Auto assignment restored.");
  });
}

function readAssignmentFromEditor() {
  const assignment = {};
  els.assignmentTable.querySelectorAll("input[data-assignment-state]").forEach((input) => {
    assignment[input.dataset.assignmentState] = input.value.trim();
  });
  return assignment;
}

function readRowsFromTable() {
  return [...els.stateTableBody.querySelectorAll("tr")].map((tr) => {
    const row = {};
    tr.querySelectorAll("input").forEach((input) => {
      row[input.dataset.key] = input.value;
    });
    return row;
  });
}

function renderAnalysis() {
  const { analysis } = state;

  renderAssignmentEditor();

  const ffEquations = analysis.equations.filter((equation) => equation.type === "ff-input");
  const outputEquation = analysis.equations.find((equation) => equation.name === "Z");

  els.equationList.innerHTML = `
    <div class="equation-heading">Flip-Flop Input Equations and Outputs (Simplified)</div>
    <div class="state-variable-note">State Variables: ${analysis.variables.state.map((name) => displayStateLabel(name)).join(" ")}</div>
    <table class="equation-table">
      <thead>
        <tr><th>Type</th><th>Input</th><th>Equation</th></tr>
      </thead>
      <tbody>
        ${ffEquations
          .map(
            (equation) => `
              <tr>
                <td>FF for ${displayEquationTarget(equation.name)}</td>
                <td class="math">${formatEquationName(equation.name)}</td>
                <td class="math">${formatEquationName(equation.name)} = ${formatExpression(equation.expression)}</td>
              </tr>
            `
          )
          .join("")}
        <tr>
          <td>Output</td>
          <td class="math">Z</td>
          <td class="math">Z = ${formatExpression(outputEquation.expression)}</td>
        </tr>
      </tbody>
    </table>
  `;

  els.equationSelect.innerHTML = analysis.equations
    .map((equation) => `<option value="${equation.name}">${equation.name}</option>`)
    .join("");
  renderAllKMaps();
  resetDiagramView();
  renderCircuitDiagram(els.circuitSvg, analysis);
}

function renderEnhancedTools() {
  if (!state.analysis) return;

  const verification = verifyEquations(state.analysis.rows, state.modelType, state.ffType, state.assignment);
  renderEnhancedVerification(verification);
  renderEnhancedDerivation(buildDerivation(state.analysis, state.ffType));
  renderSequenceSimulation();
  els.verilogOutput.value = formatVerilogForDisplay(
    generateVerilog(state.analysis, state.analysis.rows, state.modelType, state.ffType)
  );
}

function runEnhancedVerification() {
  if (!state.analysis) {
    setStatus("Generate Circuit before verification.", true);
    return;
  }

  try {
    renderEnhancedTools();
    setStatus("Enhanced verification refreshed.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function runAssignmentOptimizer() {
  try {
    const rows = readRowsFromTable();
    if (!rows.length) {
      setStatus("Enter at least one state before optimizing.", true);
      return;
    }

    const results = optimizeAssignments(rows, state.modelType, state.ffType);

    els.enhancedOptimizerView.innerHTML = results
      .map((result, index) => {
        const assignmentText = Object.entries(result.assignment)
          .map(([stateName, bits]) => `${stateName}=${bits}`)
          .join(", ");
        const equations = result.equations
          .map((equation) => `${formatEquationNamePlain(equation.name)}=${formatExpression(equation.expression)}`)
          .join(" ; ");
        return `
          <article class="optimizer-card">
            <div>
              <strong>#${index + 1} Cost ${result.score.total}</strong>
              <div>${escapeHtml(assignmentText)}</div>
              <small>${escapeHtml(equations)}</small>
            </div>
            <button class="secondary-button" data-optimizer-index="${index}" type="button">Apply</button>
          </article>
        `;
      })
      .join("");

    els.enhancedOptimizerView.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        state.assignment = results[Number(button.dataset.optimizerIndex)].assignment;
        renderAssignmentEditor();
        clearResults("Optimized assignment applied. Generate Circuit again.");
      });
    });

    setStatus("Assignment optimizer complete.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderEnhancedVerification(verification) {
  const passCount = verification.checks.filter((check) => check.pass).length;
  const failCount = verification.checks.length - passCount;

  els.enhancedVerificationView.innerHTML = `
    <div class="metric-grid">
      <div class="metric">Result<strong class="${verification.pass ? "pass" : "fail"}">${verification.pass ? "PASS" : "FAIL"}</strong></div>
      <div class="metric">Checks<strong>${verification.checks.length}</strong></div>
      <div class="metric">Passed<strong>${passCount}</strong></div>
      <div class="metric">Failed<strong>${failCount}</strong></div>
    </div>
    <div class="enhanced-equation-list">
      ${verification.analysis.equations
        .map(
          (equation) =>
            `<span class="equation-chip">${escapeHtml(formatEquationNamePlain(equation.name))} = ${escapeHtml(
              formatExpression(equation.expression)
            )}</span>`
        )
        .join("")}
    </div>
    ${tableHtml(
      ["State", "X", "Signal", "Expected", "Actual", "Pass"],
      verification.checks.map((check) => [
        check.state,
        check.input,
        formatSignalLabel(check.kind),
        check.expected,
        check.actual,
        check.pass ? "yes" : "no",
      ]),
      "small-table compact-table"
    )}
  `;
}

function renderEnhancedDerivation(derivation) {
  const excitationHeaders = Object.keys(derivation.excitationRows[0] ?? {});
  const stateGroup = formatStateVariableGroup();

  els.enhancedDerivationView.innerHTML = `
    <div class="derivation-grid">
      <article>
        <h4>Binary Transition Table</h4>
        ${tableHtml(
          ["State", stateGroup, "X", "Next", `${stateGroup}+`, "Z"],
          derivation.binaryRows.map((row) => [
            row.presentState,
            row.presentBits,
            row.input,
            row.nextState,
            row.nextBits,
            row.output,
          ]),
          "small-table"
        )}
      </article>
      <article>
        <h4>Excitation Table</h4>
        ${tableHtml(
          excitationHeaders.map(formatEnhancedHeader),
          derivation.excitationRows.map((row) => excitationHeaders.map((header) => row[header])),
          "small-table"
        )}
      </article>
    </div>
    <h4>K-Maps Used For Simplification</h4>
    <div class="derivation-kmap-grid">
      ${derivation.truthTables
        .map(
          (truth) => `
            <article class="derivation-kmap-card">
              <div class="derivation-kmap-title">${escapeHtml(formatEquationNamePlain(truth.name))} = ${escapeHtml(
                formatExpression(truth.expression)
              )}</div>
              ${renderDerivationKMap(truth.kMap)}
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderDerivationKMap(kmap) {
  const displayMap = toHorizontalKMap(kmap);
  const columnCount = displayMap.columnLabels.length;

  return `
    <div class="derivation-mini-kmap" style="--kmap-cols: ${columnCount}">
      <div class="kmap-corner">
        <span class="corner-states">${formatKMapCornerVariables(displayMap.rowVariables)}</span>
        <span class="corner-input">${escapeHtml(formatKMapVariableText(displayMap.columnVariable))}</span>
      </div>
      ${displayMap.columnLabels.map((label) => `<div class="kmap-head">${escapeHtml(label)}</div>`).join("")}
      ${displayMap.rowLabels
        .map(
          (rowLabel, rowIndex) => `
            <div class="kmap-head">${escapeHtml(rowLabel)}</div>
            ${displayMap.columnLabels
              .map((_, columnIndex) => {
                const cell = displayMap.cells[rowIndex * columnCount + columnIndex] ?? { value: "0" };
                const value = cell.value === "X" ? "X" : cell.value;
                const className = value === "1" ? "one" : value === "X" ? "dc" : "";
                return `<div class="kmap-cell ${className}"><strong>${escapeHtml(value)}</strong></div>`;
              })
              .join("")}
          `
        )
        .join("")}
    </div>
  `;
}

function formatKMapCornerVariables(value) {
  return escapeHtml(formatKMapVariableText(value).replace(/\s+/g, ""));
}

function formatVariableText(value) {
  return String(value ?? "").replace(/Q\d+/g, (qName) => displayStateLabel(qName));
}

function formatKMapVariableText(value) {
  const stateVariables = state.analysis?.variables.state ?? [];
  return String(value ?? "").replace(/Q\d+/g, (qName) => {
    const index = stateVariables.indexOf(qName);
    return index >= 0 ? `Q${index + 1}` : qName;
  });
}

function formatStateVariableGroup() {
  return state.analysis?.variables.state.map((name) => displayStateLabel(name)).join("") || "Q";
}

function formatEquationNamePlain(name) {
  const match = name.match(/^([JKTSRD])(Q\d+)$/);
  if (match) return `${match[1]}${displayStateLabel(match[2])}`;
  return formatVariableText(name);
}

function formatSignalLabel(kind) {
  if (kind === "output") return "Z";
  return formatEquationNamePlain(kind);
}

function formatEnhancedHeader(header) {
  const labels = {
    presentState: "State",
    presentBits: formatStateVariableGroup(),
    input: "X",
    nextBits: `${formatStateVariableGroup()}+`,
  };
  return labels[header] ?? formatEquationNamePlain(header);
}

function formatVerilogForDisplay(verilog) {
  return verilog.replace(/^\/\/\s*([JKT]?Q\d+|Z)\s*=\s*(.+)$/gm, (line, name, expression) => {
    const displayName = formatEquationNamePlain(name);
    return `// ${displayName} = ${formatExpression(expression.trim())}`;
  });
}

function renderSequenceSimulation() {
  if (!state.rows.length) return;

  try {
    const rows = simulateSequence(readRowsFromTable(), state.modelType, els.sequenceInput.value);
    els.sequenceSimulationView.innerHTML = tableHtml(
      ["Clock", "X", "Present State", "Next State", "Z"],
      rows.map((row) => [row.clock, row.input, row.presentState, row.nextState, row.output]),
      "small-table"
    );
  } catch (error) {
    els.sequenceSimulationView.innerHTML = `<div class="placeholder error">${escapeHtml(error.message)}</div>`;
  }
}

function tableHtml(headers, rows, className = "") {
  return `
    <div class="enhanced-table-wrap ${className}">
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows
            .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function initWaveformControls() {
  document.querySelectorAll("[name='waveformType']").forEach((input) => {
    input.addEventListener("change", () => {
      state.waveform.type = input.value;
      renderWaveform();
    });
  });

  bindWaveformParam("frequency", els.frequencySlider, els.frequencyInput);
  bindWaveformParam("amplitude", els.amplitudeSlider, els.amplitudeInput);
  bindWaveformParam("phase", els.phaseSlider, els.phaseInput);

  els.wavePlay.addEventListener("click", playWaveform);
  els.wavePause.addEventListener("click", pauseWaveform);
  els.waveReset.addEventListener("click", resetWaveform);
}

function bindWaveformParam(name, slider, numberInput) {
  const update = (value) => {
    const numeric = clamp(Number(value), Number(slider.min), Number(slider.max));
    state.waveform[name] = numeric;
    slider.value = String(numeric);
    numberInput.value = String(numeric);
    renderWaveform();
  };

  slider.addEventListener("input", () => update(slider.value));
  numberInput.addEventListener("input", () => update(numberInput.value));
}

function playWaveform() {
  if (state.waveform.playing) return;
  state.waveform.playing = true;
  state.waveform.lastTimestamp = null;
  state.waveform.animationId = requestAnimationFrame(animateWaveform);
  setStatus("Waveform playback running.");
}

function pauseWaveform() {
  state.waveform.playing = false;
  if (state.waveform.animationId) cancelAnimationFrame(state.waveform.animationId);
  state.waveform.animationId = null;
  setStatus("Waveform playback paused.");
}

function resetWaveform() {
  pauseWaveform();
  state.waveform.time = 0;
  renderWaveform();
  setStatus("Waveform time reset.");
}

function animateWaveform(timestamp) {
  if (!state.waveform.playing) return;
  if (state.waveform.lastTimestamp == null) {
    state.waveform.lastTimestamp = timestamp;
  }
  const deltaSeconds = (timestamp - state.waveform.lastTimestamp) / 1000;
  state.waveform.lastTimestamp = timestamp;
  state.waveform.time += deltaSeconds;
  renderWaveform();
  state.waveform.animationId = requestAnimationFrame(animateWaveform);
}

function renderWaveform() {
  updateWaveformLabels();
  drawWaveformCanvas();
}

function updateWaveformLabels() {
  const { type, frequency, amplitude, phase } = state.waveform;
  const period = frequency === 0 ? "infinite" : `${(1 / frequency).toFixed(3)} s`;
  const phaseText = formatPi(phase);
  const functionName = type === "sine" ? "sin" : type;

  els.frequencyLabel.textContent = `${frequency.toFixed(1)} Hz`;
  els.amplitudeLabel.textContent = amplitude.toFixed(2);
  els.phaseLabel.textContent = phaseText;
  els.mathExpression.textContent =
    type === "sine"
      ? `y = ${amplitude.toFixed(2)} * sin(2\u03c0 * ${frequency.toFixed(1)} * t + ${phaseText})`
      : `y = ${amplitude.toFixed(2)} * ${functionName}(2\u03c0 * ${frequency.toFixed(1)} * t + ${phaseText})`;
  els.summaryPanel.innerHTML = `
    <div>Amplitude<strong>${amplitude.toFixed(2)}</strong></div>
    <div>Frequency<strong>${frequency.toFixed(1)} Hz</strong></div>
    <div>Period<strong>${period}</strong></div>
    <div>Phase<strong>${phaseText}</strong></div>
  `;
}

function drawWaveformCanvas() {
  const canvas = els.waveformCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const pad = { left: 58, right: 22, top: 24, bottom: 48 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const centerY = pad.top + plotHeight / 2;
  const yScale = plotHeight / 2 / 1.2;
  const windowSeconds = 10;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  drawWaveformGrid(ctx, pad, plotWidth, plotHeight, centerY, yScale, windowSeconds);

  ctx.beginPath();
  for (let x = 0; x <= plotWidth; x += 1) {
    const t = state.waveform.time + (x / plotWidth) * windowSeconds;
    const y = centerY - waveformValue(t) * yScale;
    if (x === 0) ctx.moveTo(pad.left + x, y);
    else ctx.lineTo(pad.left + x, y);
  }
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  if (state.waveform.playing) {
    const scanX = pad.left + ((state.waveform.time % windowSeconds) / windowSeconds) * plotWidth;
    ctx.beginPath();
    ctx.moveTo(scanX, pad.top);
    ctx.lineTo(scanX, pad.top + plotHeight);
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawWaveformGrid(ctx, pad, plotWidth, plotHeight, centerY, yScale, windowSeconds) {
  ctx.strokeStyle = "#e5edf6";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#64748b";
  ctx.font = "12px Segoe UI";

  for (let second = 0; second <= windowSeconds; second += 1) {
    const x = pad.left + (second / windowSeconds) * plotWidth;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotHeight);
    ctx.stroke();
    ctx.fillText(`${second}s`, x - 8, pad.top + plotHeight + 24);
  }

  for (const value of [-1, -0.5, 0, 0.5, 1]) {
    const y = centerY - value * yScale;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotWidth, y);
    ctx.stroke();
    ctx.fillText(String(value), 18, y + 4);
  }

  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad.left, centerY);
  ctx.lineTo(pad.left + plotWidth, centerY);
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotHeight);
  ctx.stroke();

  ctx.fillStyle = "#334155";
  ctx.font = "13px Segoe UI";
  ctx.fillText("Time (s)", pad.left + plotWidth / 2 - 28, pad.top + plotHeight + 42);
  ctx.save();
  ctx.translate(14, pad.top + plotHeight / 2 + 32);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Amplitude", 0, 0);
  ctx.restore();
}

function waveformValue(t) {
  const { type, frequency, amplitude, phase } = state.waveform;
  const angle = 2 * Math.PI * frequency * t + phase;
  if (type === "square") return amplitude * (Math.sin(angle) >= 0 ? 1 : -1);
  if (type === "triangle") return amplitude * ((2 / Math.PI) * Math.asin(Math.sin(angle)));
  if (type === "sawtooth") {
    const cycle = angle / (2 * Math.PI);
    return amplitude * (2 * (cycle - Math.floor(cycle + 0.5)));
  }
  return amplitude * Math.sin(angle);
}

function formatPi(value) {
  const ratio = value / Math.PI;
  if (Math.abs(ratio) < 0.001) return "0";
  if (Math.abs(ratio - 1) < 0.001) return "1\u03c0";
  if (Math.abs(ratio - 2) < 0.001) return "2\u03c0";
  return `${ratio.toFixed(2)}\u03c0`;
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function renderAllKMaps() {
  if (!state.analysis) return;
  els.kmapView.innerHTML = `
    <div class="kmap-card-grid">
      ${state.analysis.equations.map((equation) => renderKMapCard(equation, state.analysis.kMaps[equation.name])).join("")}
    </div>
  `;
}

function renderSelectedKMap() {
  renderAllKMaps();
}

function renderKMapCard(equation, kmap) {
  const twoColumn = kmap.columnLabels.length === 2 ? " two-col" : "";
  return `
    <article class="kmap-card">
      <div class="kmap-title-row">
        <span>${formatEquationName(equation.name)}</span>
        <span>${formatExpression(equation.expression)}</span>
      </div>
      <div class="mini-kmap${twoColumn}">
        ${kmap.cells
          .map((cell) => {
            const className = cell.value === "1" ? "one" : cell.value === "X" ? "dc" : "";
            return `
              <div class="mini-kmap-cell ${className}" title="${cell.bits}">
                <span class="minterm-label">m${Number.parseInt(cell.bits, 2)}</span>
                <span>${cell.value === "X" ? "-" : cell.value}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    </article>
  `;
}

function renderEmptyResults() {
  els.equationList.innerHTML = '<div class="placeholder">Generate a circuit to see flip-flop input equations.</div>';
  els.equationSelect.innerHTML = "";
  els.kmapView.innerHTML = '<div class="placeholder">K-map appears here after generation.</div>';
  renderEmptyEnhancedTools();
  els.circuitSvg.innerHTML = "";
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  els.circuitSvg.setAttribute("viewBox", "0 0 600 280");
  text.setAttribute("x", "300");
  text.setAttribute("y", "140");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("fill", "#647184");
  text.setAttribute("font-size", "16");
  text.textContent = "Circuit diagram appears after generation.";
  els.circuitSvg.appendChild(text);
}

function renderEmptyEnhancedTools() {
  els.enhancedVerificationView.innerHTML =
    '<div class="placeholder">Generate a circuit to verify equations against the state table.</div>';
  els.enhancedOptimizerView.innerHTML =
    '<div class="placeholder">Try alternate state assignments and compare equation cost.</div>';
  els.enhancedDerivationView.innerHTML =
    '<div class="placeholder">Binary transitions, excitation values, and horizontal K-maps appear after generation.</div>';
  els.sequenceSimulationView.innerHTML = '<div class="placeholder">Simulate a clock input sequence after generation.</div>';
  els.verilogOutput.value = "";
}

function formatEquationName(name) {
  const match = name.match(/^([JKTSRD])(Q\d+)$/);
  if (!match) return name;
  return `${match[1]}<sub>${displayStateLabel(match[2])}</sub>`;
}

function formatExpression(expression) {
  return expression.replace(/\s+/g, "").replace(/Q\d+'?|X'?|[+]/g, (token) => {
    if (token === "+") return " + ";
    if (token.startsWith("Q")) {
      const inverted = token.endsWith("'");
      const qName = inverted ? token.slice(0, -1) : token;
      return `${displayStateLabel(qName)}${inverted ? "'" : ""}`;
    }
    return token;
  });
}

function displayEquationTarget(name) {
  const match = name.match(/Q\d+$/);
  return match ? displayStateLabel(match[0]) : name;
}

function displayStateLabel(qName) {
  const index = state.analysis?.variables.state.indexOf(qName) ?? -1;
  return index >= 0 ? String.fromCharCode(65 + index) : qName;
}

function clearResults(message) {
  state.analysis = null;
  renderEmptyResults();
  setStatus(message);
}

function setStatus(message, isError = false) {
  els.statusText.textContent = message;
  els.statusText.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
