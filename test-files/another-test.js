import ollama from "ollama";

// --- Classifier prompt (simplified, client-friendly) ---
const classifierPrompt = `
You are a Malaysian legal domain classifier AI.

A user will ask a question about Malaysian law. Classify the question into ONE of the categories:
- civil
- corporate
- criminal
- general (any topic outside the above three)

Definitions:
- Civil: questions about contracts, property, landlord-tenant issues, family matters, or other civil law topics. Example: "Can a landlord evict a tenant without notice in Selangor?"
- Corporate: questions about starting or running a company, commercial agreements, or corporate compliance. Example: "How do I register a private limited company in Putrajaya?"
- Criminal: questions about crimes, penalties, arrests, or investigations. Example: "Is theft a crime in Kuala Lumpur?"
- General: any other Malaysian law topic not covered above, e.g., Federal Constitution, general legal principles.

Respond with ONLY ONE WORD: civil, corporate, criminal, or general.
`;

// --- Map classifier categories to ASLAW models ---
function routeModel(category) {
  switch (category) {
    case "civil": return "aslaw-civil";
    case "corporate": return "aslaw-corporate";
    case "criminal": return "aslaw-criminal";
    default: return "aslaw-general";
  }
}

// --- Create client-friendly prompts for each ASLAW model ---
function getASLAWPrompt(category, userInput) {
  switch (category) {
    case "civil":
      return `
You are ASLAW, a Malaysian legal assistant.

Explain the question in a simple, client-friendly way.
Focus ONLY on MALAYSIAN CIVIL LAW.
Mention relevant Acts if helpful.
Do NOT give legal advice or predict outcomes.

User question: "${userInput}"
`;
    case "corporate":
      return `
You are ASLAW, a Malaysian legal assistant.

Explain the question in a simple way that anyone can understand.
Focus ONLY on MALAYSIAN CORPORATE LAW.
Mention relevant Acts if helpful.
Do NOT give advice or interpretation.

User question: "${userInput}"
`;
    case "criminal":
      return `
You are ASLAW, a Malaysian legal assistant.

Explain the question simply for a general person.
Focus ONLY on MALAYSIAN CRIMINAL LAW.
Mention relevant Acts if helpful.
Do NOT give defense strategies or advice.

User question: "${userInput}"
`;
    default:
      return `
You are ASLAW, a Malaysian legal assistant.

Provide a general explanation in plain language for someone unfamiliar with the law.
Focus on Malaysian law in general.
Mention relevant Acts if helpful.

User question: "${userInput}"
`;
  }
}

// --- Main processing function ---
async function processQuestion(userQuestion) {
  // 1️⃣ Classify
  const classifierResponse = await ollama.chat({
    model: "phi3:mini",
    messages: [
      { role: "system", content: classifierPrompt },
      { role: "user", content: userQuestion }
    ]
  });

  const category = classifierResponse.message.content.trim().toLowerCase();
  const model = routeModel(category);

  console.log("Classifier:", category, "| ASLAW model:", model);

  // 2️⃣ Call corresponding ASLAW model
  const aslawPrompt = getASLAWPrompt(category, userQuestion);

  const aslawResponse = await ollama.chat({
    model: model,
    messages: [
      { role: "system", content: aslawPrompt },
      { role: "user", content: userQuestion }
    ]
  });

  console.log("\n--- ASLAW Response ---");
  console.log(aslawResponse.message.content);
}

// --- Test multiple sample questions ---
async function testSamples() {
  const questions = [
    "Can a landlord evict a tenant without notice in Selangor?",
    "How do I register a private limited company in Putrajaya?",
    "Is theft punishable in Kuala Lumpur?",
    "What rights does the Federal Constitution give to citizens?"
  ];

  for (const q of questions) {
    console.log("\n===============================");
    console.log("User Question:", q);
    await processQuestion(q);
  }
}

testSamples();