import 'dotenv/config';
import express from 'express';
import ollama from 'ollama';
import { classifierPrompt, getASLAWPrompt, routeModel } from './logic.js';
import { getDatabaseHealth, initializeDatabases, saveChat, findChats } from './database.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));

await initializeDatabases();

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

app.get('/db-health', (req, res) => {
  res.json(getDatabaseHealth());
});

// ====================================
// 💾 SAVE CHAT ENDPOINT
// ====================================
app.post('/save-chat', async (req, res) => {
  const { question, answers, model, category } = req.body;

  if (!question || !answers || !model) {
    return res.status(400).json({ 
      error: "Missing required fields: question, answers, model" 
    });
  }

  try {
    const result = await saveChat({
      question,
      answers,
      model,
      category,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    res.status(201).json({
      success: true,
      message: "Chat saved successfully",
      chatId: result.insertedId
    });
  } catch (error) {
    console.error("Error saving chat:", error);
    res.status(400).json({ 
      error: error.message || "Failed to save chat. Check schema validation."
    });
  }
});

// ====================================
// 🔍 RETRIEVE CHATS ENDPOINT
// ====================================
app.get('/chats', async (req, res) => {
  const { model, category, limit = 10 } = req.query;
  
  try {
    const query = {};
    if (model) query.model = model;
    if (category) query.category = category;

    const chats = await findChats(query);
    res.json({
      count: chats.length,
      chats: chats.slice(0, parseInt(limit))
    });
  } catch (error) {
    console.error("Error retrieving chats:", error);
    res.status(500).json({ error: error.message });
  }
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
    const systemPrompt = getASLAWPrompt(category, question);
    const conversation = [
      { role: "system", content: systemPrompt },
      { role: "user", content: question }
    ];

    let finalAnswer = "";
    let aslawResponse = null;

    // Try once, then continue once more if generation stopped due to length.
    for (let attempt = 0; attempt < 2; attempt++) {
      aslawResponse = await ollama.chat({
        model: model,
        messages: conversation,
        options: {
          temperature: 0.2,
          num_predict: 600
        }
      });

      const chunk = aslawResponse?.message?.content || "";
      finalAnswer += (finalAnswer ? "\n\n" : "") + chunk;

      if (aslawResponse?.done_reason !== "length") {
        break;
      }

      conversation.push({ role: "assistant", content: chunk });
      conversation.push({
        role: "user",
        content: "Continue from where you stopped. Do not repeat earlier points. Finish with a short safety reminder."
      });
    }

    const responseData = {
      answer: finalAnswer || "No response generated.",
      category,
      model
    };

    // Save every ask request automatically
    try {
      const chatResult = await saveChat({
        question,
        answers: finalAnswer,
        model,
        category,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      responseData.chatId = chatResult.insertedId;
      responseData.saved = true;
      console.log("Chat saved with ID:", chatResult.insertedId);
    } catch (saveError) {
      console.error("Warning: Could not save chat:", saveError.message);
      responseData.saved = false;
      responseData.saveError = saveError.message;
    }

    res.json(responseData);

  } catch (error) {
    console.error("ERROR:", error);
    res.status(500).json({ error: "Ollama connection failed" });
  }
});

app.listen(3000, () => {
  console.log('ASLAW Framework running on http://localhost:3000');
});