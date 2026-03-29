import 'dotenv/config';
import express from 'express';
import ollama from 'ollama';
import { classifierPrompt, getASLAWPrompt, hasCriminalKeywords, routeModel } from './logic.js';
import { getDatabaseHealth, initializeDatabases, saveChat, findChats } from './database.js';

const app = express();
app.use(express.json());
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:3000";

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", frontendOrigin);
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User-FirmID");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

await initializeDatabases();

// ------------------------------------
// 🔥 Warm up base model once at startup
// ------------------------------------
console.log("Warming up phi3:mini model...");
try {
  await Promise.race([
    ollama.chat({
      model: "phi3:mini",
      messages: [{ role: "user", content: "Hello" }],
      options: { num_predict: 1 }
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Warm-up timed out after 8s")), 8000)
    )
  ]);
  console.log("Model ready!");
} catch (error) {
  // Keep API alive even if Ollama is temporarily unavailable.
  console.warn("Model warm-up skipped:", error.message);
}

app.get('/', (req, res) => {
  res.send('<h1>ASLAW Chatbot API is running</h1><p>Use POST /ask, GET /chats, GET /db-health</p>');
});

app.get('/db-health', (req, res) => {
  res.json(getDatabaseHealth());
});

// ====================================
// 💾 SAVE CHAT ENDPOINT
// ====================================
app.post('/save-chat', async (req, res) => {
  const { question, answers, model, category, firmID } = req.body;

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
    }, { firmID });

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
  const { model, category, limit = 10, firmID } = req.query;
  
  try {
    const query = {};
    if (model) query.model = model;
    if (category) query.category = category;

    const chats = await findChats(query, { firmID });
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
  const firmID = req.body?.firmID || req.headers["x-user-firmid"];

  const classifierEnabled = (process.env.CLASSIFIER_ENABLED || 'true').toLowerCase() === 'true';
  const classifierBypassOnCriminalKeywords = (process.env.CLASSIFIER_BYPASS_ON_CRIMINAL_KEYWORDS || 'true').toLowerCase() === 'true';
  const defaultNumPredict = Number.parseInt(process.env.DEFAULT_NUM_PREDICT || '600', 10);
  const criminalNumPredict = Number.parseInt(process.env.CRIMINAL_NUM_PREDICT || '350', 10);

  const classifierTimeoutMs = Number.parseInt(process.env.CLASSIFIER_TIMEOUT_MS || '12000', 10);
  const generationTimeoutMs = Number.parseInt(process.env.GENERATION_TIMEOUT_MS || '60000', 10);
  const criminalModelFallback = process.env.CRIMINAL_MODEL_FALLBACK || 'aslaw-general';
  const criminalFallbackAfterMs = Number.parseInt(process.env.CRIMINAL_MODEL_FALLBACK_AFTER_MS || '60000', 10);

  function isGreetingOnly(text) {
    const normalized = String(text || '').trim().toLowerCase();
    return /^(hi|hello|hey|salam|hai|good morning|good afternoon|good evening)$/.test(normalized);
  }

  async function chatWithTimeout(payload, timeoutMs, label) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return ollama.chat(payload);
    }

    return Promise.race([
      ollama.chat(payload),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  }

  function isTimeoutLikeError(error) {
    const message = String(error?.message || '');
    const code = String(error?.code || error?.cause?.code || '');

    return (
      message.includes('timeout') ||
      message.includes('Headers Timeout') ||
      code.includes('TIMEOUT')
    );
  }

  if (!question) {
    return res.status(400).json({ error: "No question provided." });
  }

  if (isGreetingOnly(question)) {
    const responseData = {
      answer: "Hello. I can help with Malaysian legal information. Please share your legal question and, if possible, include key facts such as location, dates, and documents.",
      category: 'general',
      model: 'aslaw-general',
      rag: {
        used: false,
        strategy: 'greeting-bypass',
        timedOut: false,
        chunkCount: 0,
        sources: []
      }
    };

    try {
      const chatResult = await saveChat({
        question,
        answers: responseData.answer,
        model: responseData.model,
        category: responseData.category,
        createdAt: new Date(),
        updatedAt: new Date()
      }, { firmID });
      responseData.chatId = chatResult.insertedId;
      responseData.saved = true;
    } catch (saveError) {
      responseData.saved = false;
      responseData.saveError = saveError.message;
    }

    return res.json(responseData);
  }

  try {
    const requestStartedAt = Date.now();
    console.log("Incoming question:", question);

    // =====================================
    // 1️⃣ SECURE CLASSIFICATION (JSON SAFE)
    // =====================================
    let category = "general";
    const keywordSuggestsCriminal = hasCriminalKeywords(question);

    if (classifierBypassOnCriminalKeywords && keywordSuggestsCriminal) {
      category = 'criminal';
      console.log('Classifier bypassed by criminal keyword match.');
    }

    if (classifierEnabled && !(classifierBypassOnCriminalKeywords && keywordSuggestsCriminal)) {
      try {
        const classifierResponse = await chatWithTimeout({
          model: "phi3:mini",
          messages: [
            { role: "system", content: classifierPrompt },
            { role: "user", content: question }
          ],
          options: {
            temperature: 0,
            num_predict: 50
          }
        }, classifierTimeoutMs, 'Classifier generation');

        const rawOutput = classifierResponse?.message?.content || "";
        console.log("Raw classifier output:\n", rawOutput);

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
      } catch (classifierError) {
        console.warn('Classifier failed. Using fallback category:', classifierError.message);
      }
    } else if (!classifierEnabled) {
      console.log('Classifier disabled. Using fallback category logic.');
    }

    const criminalKeywordOverrideEnabled = (process.env.CRIMINAL_KEYWORD_OVERRIDE || 'true').toLowerCase() === 'true';

    if (criminalKeywordOverrideEnabled && keywordSuggestsCriminal && category !== 'criminal') {
      console.log(`Category overridden by criminal keyword match: ${category} -> criminal`);
      category = 'criminal';
    }

    console.log("Final category:", category);

    const model = routeModel(category);
    console.log("Model selected:", model);

    // =====================
    // 2️⃣ FINAL ANSWER CALL
    // =====================
    const systemPromptNoRag = getASLAWPrompt(category, question, '');

    let conversation = [
      { role: "system", content: systemPromptNoRag },
      { role: "user", content: question }
    ];

    let finalAnswer = "";
    let aslawResponse = null;
    let activeModel = model;
    let numPredict = category === 'criminal' ? criminalNumPredict : defaultNumPredict;
    const reducedNumPredict = Number.parseInt(process.env.REDUCED_NUM_PREDICT || '220', 10);
    let retriedWithFallbackModel = false;
    let retriedWithReducedPredict = false;

    // Try once, then continue once more if generation stopped due to length.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        aslawResponse = await chatWithTimeout({
          model: activeModel,
          messages: conversation,
          options: {
            temperature: 0.2,
            num_predict: numPredict
          }
        }, generationTimeoutMs, 'Final response generation');
      } catch (generationError) {
        if (
          !retriedWithReducedPredict &&
          isTimeoutLikeError(generationError)
        ) {
          console.warn(`Generation timed out. Retrying with reduced output budget: ${reducedNumPredict}`);
          retriedWithReducedPredict = true;
          numPredict = reducedNumPredict;
          finalAnswer = '';
          conversation = [
            { role: "system", content: systemPromptNoRag },
            { role: "user", content: question }
          ];
          attempt -= 1;
          continue;
        }

        if (
          activeModel === 'aslaw-criminal' &&
          !retriedWithFallbackModel &&
          isTimeoutLikeError(generationError) &&
          (Date.now() - requestStartedAt) >= criminalFallbackAfterMs
        ) {
          console.warn(`Criminal model timed out. Retrying with fallback model: ${criminalModelFallback}`);
          retriedWithFallbackModel = true;
          activeModel = criminalModelFallback;
          numPredict = defaultNumPredict;
          finalAnswer = '';
          conversation = [
            { role: "system", content: systemPromptNoRag },
            { role: "user", content: question }
          ];
          attempt -= 1;
          continue;
        }

        throw generationError;
      }

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
      model: activeModel,
      rag: {
        used: false,
        strategy: 'disabled',
        timedOut: false,
        chunkCount: 0,
        sources: []
      }
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
      }, { firmID });
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
    if (isTimeoutLikeError(error)) {
      return res.status(504).json({
        error: 'Model request timed out. Please try a shorter question or try again in a moment.'
      });
    }
    res.status(500).json({ error: "Ollama connection failed" });
  }
});

const port = 3001;

app.listen(port, () => {
  console.log(`ASLAW Chatbot API running on http://localhost:${port}`);
});