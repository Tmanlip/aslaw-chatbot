import ollama from "ollama";

const classifierPrompt = `You are a Malaysian legal domain classifier AI. 

Classify the following user question into ONE of these categories:
- civil
- corporate
- criminal
- general (any topic outside the above three)

Use the following definitions:

- Civil: contracts, torts, property/landlord-tenant law, family law, civil procedures. Example: "Can a landlord evict a tenant without notice in Selangor?"
- Corporate: company law, governance, commercial contracts, corporate compliance. Example: "How do I register a private limited company in Putrajaya?"
- Criminal: criminal offences, arrests, investigations, penalties. Example: "Is theft a crime in Kuala Lumpur?"
- General: any other Malaysian law topic not covered above, e.g., Federal Constitution, general legal principles.

Respond with ONLY ONE WORD: civil, corporate, criminal, or general.
`

async function classifyQuestion(userInput) {
  const response = await ollama.chat({
    model: "phi3:mini",
    messages: [
      { role: "system", content: classifierPrompt },
      { role: "user", content: userInput }
    ]
  });

  return response.message.content.trim().toLowerCase();
}

function routeModel(category) {
  if (category === "civil") return "aslaw-civil";
  if (category === "corporate") return "aslaw-corporate";
  if (category === "criminal") return "aslaw-criminal";
  return "aslaw-general";
}

// Test example
async function main() {
  const question = "Can a landlord evict a tenant without notice in Selangor?";
  const category = await classifyQuestion(question);
  const model = routeModel(category);
  console.log("Category:", category, "| Model to call:", model);
}

main();