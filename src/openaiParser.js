const parserSchema = {
  type: "object",
  additionalProperties: false,
  required: ["modelType", "initialState", "states", "rows", "notes"],
  properties: {
    modelType: {
      type: "string",
      enum: ["mealy", "moore"],
    },
    initialState: {
      type: "string",
      description: "Initial state label, such as A.",
    },
    states: {
      type: "array",
      items: { type: "string" },
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["state", "next0", "out0", "next1", "out1", "output"],
        properties: {
          state: { type: "string" },
          next0: { type: "string" },
          out0: { type: "string", enum: ["0", "1"] },
          next1: { type: "string" },
          out1: { type: "string", enum: ["0", "1"] },
          output: { type: "string", enum: ["0", "1"] },
        },
      },
    },
    notes: {
      type: "string",
      description: "Short explanation of how states were chosen.",
    },
  },
};

export async function parseStateTableWithOpenAI({ apiKey, model, problemText, modelType }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: buildSystemPrompt(),
        },
        {
          role: "user",
          content: [
            `Selected model type: ${modelType}`,
            "Assume exactly one binary input variable X and one binary output variable Z.",
            "Convert this sequential-circuit problem into the required normalized state table JSON:",
            problemText,
          ].join("\n\n"),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "state_table_parse",
          strict: true,
          schema: parserSchema,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.error?.message ?? `OpenAI API request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  const text = extractOutputText(payload);
  if (!text) {
    throw new Error("The API response did not contain parseable JSON text.");
  }

  const parsed = JSON.parse(text);
  return normalizeAiRows(parsed, modelType);
}

function buildSystemPrompt() {
  return [
    "You are a digital logic design assistant.",
    "Your task is to convert natural-language sequential circuit descriptions into a normalized state table.",
    "Only support one binary input X and one binary output Z.",
    "Use the user's selected model type exactly: mealy or moore.",
    "For Mealy machines, output may depend on present state and input. Fill out0 and out1. Set output to 0.",
    "For Moore machines, output depends only on present state. Fill output. Also set out0 and out1 equal to output.",
    "Create enough states to represent the required history for overlapping sequence detection when needed.",
    "Every state must define next0 and next1.",
    "Use short state labels A, B, C, D unless the problem clearly provides labels.",
    "Do not simplify equations and do not draw circuits.",
  ].join(" ");
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;

  const parts = [];
  for (const item of payload?.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("");
}

function normalizeAiRows(parsed, selectedModelType) {
  if (parsed.modelType !== selectedModelType) {
    throw new Error(`AI returned ${parsed.modelType}, but the selected model is ${selectedModelType}.`);
  }

  const rows = parsed.rows.map((row) =>
    selectedModelType === "mealy"
      ? {
          state: row.state,
          next0: row.next0,
          out0: row.out0,
          next1: row.next1,
          out1: row.out1,
        }
      : {
          state: row.state,
          output: row.output,
          next0: row.next0,
          next1: row.next1,
        }
  );

  return { rows, notes: parsed.notes };
}
