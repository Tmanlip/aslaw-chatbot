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

const CRIMINAL_KEYWORD_PATTERNS = [
  /\bcriminal\b/i,
  /\boffence\b/i,
  /\boffense\b/i,
  /\bpenalty\b/i,
  /\bpunishment\b/i,
  /\bcharge\b/i,
  /\barrest\b/i,
  /\bpolice\b/i,
  /\bprosecution\b/i,
  /\bcourt\b/i,
  /\bbail\b/i,
  /\bremand\b/i,
  /\bconvict\w*\b/i,
  /\bsentence\w*\b/i,
  /\bmurder\b/i,
  /\bhomicide\b/i,
  /\bmanslaughter\b/i,
  /\bkill\w*\b/i,
  /\bslay\w*\b/i,
  /\bstab\w*\b/i,
  /\bshot\b/i,
  /\bshoot\w*\b/i,
  /\bself[-\s]?defen[cs]e\b/i,
  /\bbreak\s+into\b/i,
  /\bintrud\w*\b/i,
  /\btrespass\w*\b/i,
  /\bassault\b/i,
  /\btheft\b/i,
  /\bsteal\b/i,
  /\brobbery\b/i,
  /\bburglary\b/i,
  /\bfraud\b/i,
  /\bforgery\b/i,
  /\bextortion\b/i,
  /\bkidnap\b/i,
  /\bbribe\b/i,
  /\bcorruption\b/i,
  /\bdrug\w*\b/i,
  /\bnarcotic\w*\b/i,
  /\btraffick\w*\b/i,
  /\bfirearm\w*\b/i,
  /\bweapon\w*\b/i,
  /\bkanun\s+keseksaan\b/i,
  /\bkanun\s+tatacara\s+jenayah\b/i,
  /\bjenayah\b/i,
  /\bpolis\b/i,
  /\btangkapan\b/i,
  /\bdadah\b/i,
  /\brompak\b/i,
  /\bcuri\b/i,
  /\brasuah\b/i
];

export function hasCriminalKeywords(text) {
  const input = String(text || '');
  if (!input.trim()) {
    return false;
  }

  return CRIMINAL_KEYWORD_PATTERNS.some((pattern) => pattern.test(input));
}

// ------------------------------------
// 🧠 DYNAMIC SYSTEM PROMPT
// ------------------------------------
export function getASLAWPrompt(category, userInput, retrievedContext = '') {
  const contextBlock = retrievedContext
    ? `
Knowledge base excerpts (RAG):
${retrievedContext}

Context usage rules:
- Prioritize these excerpts over general memory
- If context is insufficient, say what is missing instead of guessing
- Cite sources in square brackets when using excerpted facts
`
    : '';

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
- Use clear, complete step-by-step formatting that fully finishes the answer
- If the user describes immediate danger, serious injury, or witnessing a violent crime:
  - Prioritize safety first
  - Tell them to call Malaysia emergency services at 999 (or 112 from mobile)
  - Encourage preserving evidence and prompt police reporting
  - Do not invent specific station names or uncertain phone numbers

${contextBlock}

User question:
"${userInput}"
`;
}