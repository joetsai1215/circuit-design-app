# Sequential Circuit Design Automation System (AI-Enhanced)

This is the first runnable web prototype for a sequential circuit design automation tool.

## Current MVP Scope

- Single input: `X`
- Single output: `Z`
- Model types: Mealy and Moore
- Flip-flop types: JK, T, SR, and D
- Editable state table
- Local example parser for the "three or more consecutive 1s" problem
- Optional OpenAI API key input for real AI text-to-state-table parsing
- Editable state assignment, with automatic assignment as the default
- Flip-flop excitation equation generation
- K-map data display
- SVG circuit diagram with zoom and pan
- Equation self-verification against the generated transition table
- Step-by-step binary transition / excitation tables
- Horizontal K-map derivation view with don't-care terms shown as `X`
- State-assignment optimizer for comparing simpler equation costs
- Input sequence simulation and Verilog export
- Interactive waveform signal simulator with live formula updates, grid plot, and playback controls

## Run Locally

From this folder:

```powershell
python -m http.server 5173 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:5173
```

## Logic Architecture

The core logic is in `src/logic.js`.

Pipeline:

```text
state table
→ validation
→ editable/custom state assignment
→ transition expansion
→ flip-flop excitation table
→ SOP simplification
→ K-map data
→ circuit graph
```

The UI never guesses equations. Equations are derived from present-state bits, next-state bits, and the selected flip-flop excitation table.

## Text-to-State-Table Plan

The prototype can now parse natural-language descriptions with a user-provided OpenAI API key. The key is entered in the browser and can be saved locally with `localStorage`.

For a classroom demo on GitHub Pages, this lets each user use their own key. For a production app, use a backend proxy instead of calling the API directly from the browser.

Current AI parser limits:

- One binary input variable: `X`
- One binary output variable: `Z`
- Mealy or Moore, selected by the UI
- The model must return a normalized state table JSON

The direct browser call uses:

```text
POST https://api.openai.com/v1/responses
```

with Structured Outputs JSON schema.

For a production backend version, add an endpoint:

```text
POST /api/parse-state-table
```

The endpoint should call an LLM and require strict JSON output:

```json
{
  "modelType": "mealy",
  "inputs": ["X"],
  "outputs": ["Z"],
  "initialState": "A",
  "states": ["A", "B", "C"],
  "transitions": [
    {
      "presentState": "A",
      "input": "0",
      "nextState": "A",
      "output": "0"
    }
  ]
}
```

After the LLM returns JSON, validate that every state has every input combination, every next state exists, and every output is a valid bit string. Do not let the LLM generate Boolean equations or the circuit diagram directly.

## Diagram Rendering Plan

The current prototype uses SVG so it can run without installing packages. For a production frontend, replace `src/diagram.js` with:

- React Flow for interactive nodes and wires
- ELK.js for automatic circuit layout
- Custom node components for JK/T flip-flops, AND/OR/NOT gates, clock, input, and output
