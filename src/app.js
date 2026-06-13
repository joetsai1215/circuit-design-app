import { analyzeCircuit, assignStates, examples, parseDescriptionToTable } from "./logic.js";
import { bindDiagramPan, renderCircuitDiagram, resetDiagramView, zoomDiagram } from "./diagram.js";
import { parseStateTableWithOpenAI } from "./openaiParser.js";

const state = {
  modelType: "mealy",
  ffType: "jk",
  rows: structuredClone(examples.mealyThreeOnes.rows),
  assignment: {},
  analysis: null,
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
  els.equationSelect.addEventListener("change", renderSelectedKMap);

  document.querySelector("#zoomOutButton").addEventListener("click", () => zoomDiagram(els.circuitSvg, -0.15));
  document.querySelector("#zoomInButton").addEventListener("click", () => zoomDiagram(els.circuitSvg, 0.15));
  document.querySelector("#zoomResetButton").addEventListener("click", () => {
    resetDiagramView();
    renderCircuitDiagram(els.circuitSvg, state.analysis);
  });

  bindDiagramPan(els.circuitSvg);
  loadApiSettings();
  resetAssignmentFromRows();
  renderBadges();
  renderStateTable();
  renderEmptyResults();
}

function loadApiSettings() {
  els.apiKeyInput.value = localStorage.getItem("scdas_openai_api_key") ?? "";
  els.apiModelInput.value = localStorage.getItem("scdas_openai_model") ?? "gpt-4o-mini";
}

function renderBadges() {
  els.modelBadge.textContent = state.modelType === "mealy" ? "MEALY Model" : "MOORE Model";
  els.ffBadge.textContent = state.ffType === "jk" ? "JK Flip-Flop" : "T Flip-Flop";
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
    state.assignment = state.analysis.assignment;
    renderAnalysis();
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

function formatEquationName(name) {
  const match = name.match(/^([JKT])(Q\d+)$/);
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
