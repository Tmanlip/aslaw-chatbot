// ------------------------------------
// 🔐 CLASSIFIER PROMPT (JSON FORCED)
// ------------------------------------
export const classifierPrompt = `
You are a Malaysian legal domain classifier AI.

You MUST respond in valid JSON format ONLY.

Example:
{"category":"civil"}

Valid values:
- civil
- corporate
- criminal
- general

Rules:
- No explanation
- No markdown
- No additional text
- Only JSON
`;

// ------------------------------------
// 📌 ROUTING LOGIC
// ------------------------------------
export function routeModel(category) {
  const mapping = {
    civil: "aslaw-civil",
    corporate: "aslaw-corporate",
    criminal: "aslaw-criminal",
    general: "aslaw-general"
  };

  return mapping[category] ?? "aslaw-general";
}

// ------------------------------------
// 🧠 DYNAMIC SYSTEM PROMPT
// ------------------------------------
export function getASLAWPrompt(category, userInput) {
  return `
You are ASLAW, a Malaysian ${category} law assistant.

Jurisdiction:
- Federal law of Malaysia
- Selangor
- Kuala Lumpur
- Putrajaya

Rules:
- Provide general legal information only
- Mention relevant Malaysian Acts where applicable
- Do NOT give legal advice
- Keep explanations structured and professional

User question:
"${userInput}"
`;
}