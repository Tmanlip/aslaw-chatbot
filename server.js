import express from 'express';
import ollama from 'ollama';
import { classifierPrompt, getASLAWPrompt, routeModel } from './logic.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ------------------------------------
// 🔥 Warm up base model once at startup
// ------------------------------------
console.log("Warming up phi3:mini model...");
await ollama.chat({
  model: "phi3:mini",
  messages: [{ role: "user", content: "Hello" }],
  options: { num_predict: 1 }
});
console.log("Model ready!");

app.get('/', (req, res) => {
  res.send('<h1>ASLAW Chatbot Server is Running!</h1><p>Send a POST request to /ask to chat.</p>');
});

app.post('/ask', async (req, res) => {
  const { question } = req.body;

  if (!question) {
    return res.status(400).json({ error: "No question provided." });
  }

  try {
    console.log("Incoming question:", question);

    // =====================================
    // 1️⃣ SECURE CLASSIFICATION (JSON SAFE)
    // =====================================
    const classifierResponse = await ollama.chat({
      model: "phi3:mini",
      messages: [
        { role: "system", content: classifierPrompt },
        { role: "user", content: question }
      ],
      options: {
        temperature: 0,
        num_predict: 50
      }
    });

    const rawOutput = classifierResponse?.message?.content || "";
    console.log("Raw classifier output:\n", rawOutput);

    let category = "general"; // safe fallback

    try {
      // Extract first JSON block only
      const jsonMatch = rawOutput.match(/\{[\s\S]*?\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        const allowed = ["civil", "corporate", "criminal", "general"];

        if (allowed.includes(parsed.category)) {
          category = parsed.category;
        } else {
          console.log("Invalid category detected. Using fallback.");
        }
      } else {
        console.log("No JSON found. Using fallback.");
      }

    } catch (err) {
      console.log("JSON parse failed. Using fallback.");
    }

    console.log("Final category:", category);

    const model = routeModel(category);
    console.log("Model selected:", model);

    // =====================
    // 2️⃣ FINAL ANSWER CALL
    // =====================
    const aslawResponse = await ollama.chat({
      model: model,
      messages: [
        { role: "system", content: getASLAWPrompt(category, question) },
        { role: "user", content: question }
      ],
      options: {
        temperature: 0.2,
        num_predict: 250
      }
    });

    res.json({
      answer: aslawResponse?.message?.content || "No response generated.",
      category
    });

  } catch (error) {
    console.error("ERROR:", error);
    res.status(500).json({ error: "Ollama connection failed" });
  }
});

app.listen(3000, () => {
  console.log('ASLAW Framework running on http://localhost:3000');
});