import ollama from 'ollama';
import { MongoClient } from 'mongodb';
import { getMongoDb } from './database.js';

const DEFAULT_COLLECTION = process.env.RAG_COLLECTION || 'criminal';
const DEFAULT_EMBED_MODEL = process.env.RAG_EMBED_MODEL || 'nomic-embed-text';
let ragMongoClient = null;
let ragMongoDb = null;

function resolveRagMongoUri() {
  return process.env.RAG_MONGODB_URI || process.env.MONGODB_URI || '';
}

function resolveRagDbName() {
  return process.env.RAG_MONGODB_DB || process.env.MONGODB_DB || 'aslaw';
}

export async function getRagDb() {
  // If no dedicated RAG DB config is provided, reuse the main MongoDB connection.
  if (!process.env.RAG_MONGODB_DB && !process.env.RAG_MONGODB_URI) {
    return getMongoDb();
  }

  if (ragMongoDb) {
    return ragMongoDb;
  }

  const uri = resolveRagMongoUri();
  if (!uri) {
    throw new Error('Missing MongoDB URI for RAG database. Set MONGODB_URI or RAG_MONGODB_URI.');
  }

  const dbName = resolveRagDbName();

  ragMongoClient = new MongoClient(uri);
  await ragMongoClient.connect();
  ragMongoDb = ragMongoClient.db(dbName);
  await ragMongoDb.command({ ping: 1 });

  return ragMongoDb;
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toFloat(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeEmbedding(response) {
  if (Array.isArray(response?.embeddings) && Array.isArray(response.embeddings[0])) {
    return response.embeddings[0];
  }

  if (Array.isArray(response?.embedding)) {
    return response.embedding;
  }

  return null;
}

export async function embedText(text, model = DEFAULT_EMBED_MODEL) {
  const cleanText = String(text || '').trim();

  if (!cleanText) {
    throw new Error('Cannot embed empty text.');
  }

  // Support both new and older Ollama client APIs.
  try {
    const response = await ollama.embed({
      model,
      input: cleanText
    });

    const embedding = normalizeEmbedding(response);
    if (!embedding) {
      throw new Error('Ollama embed() returned no embedding vector.');
    }

    return embedding;
  } catch (primaryError) {
    const response = await ollama.embeddings({
      model,
      prompt: cleanText
    });

    const embedding = normalizeEmbedding(response);
    if (!embedding) {
      throw new Error(`Failed to create embedding: ${primaryError.message}`);
    }

    return embedding;
  }
}

function dotProduct(a, b) {
  const length = Math.min(a.length, b.length);
  let total = 0;

  for (let i = 0; i < length; i += 1) {
    total += a[i] * b[i];
  }

  return total;
}

function vectorNorm(vector) {
  let sumSquares = 0;

  for (const n of vector) {
    sumSquares += n * n;
  }

  return Math.sqrt(sumSquares);
}

function cosineSimilarity(a, b) {
  const denominator = vectorNorm(a) * vectorNorm(b);
  if (!denominator) return 0;
  return dotProduct(a, b) / denominator;
}

function buildCitation(chunk) {
  const source = chunk?.metadata?.source || 'unknown-source';
  const section = chunk?.metadata?.section || chunk?.metadata?.chunkIndex;
  if (section === undefined || section === null) {
    return source;
  }

  return `${source} (section: ${section})`;
}

function buildContextFromChunks(chunks, maxChars) {
  const lines = [];
  let usedChars = 0;

  for (const chunk of chunks) {
    const citation = buildCitation(chunk);
    const text = String(chunk?.text || '').trim();
    if (!text) continue;

    const block = `[Source: ${citation}]\n${text}`;
    if (usedChars + block.length > maxChars) {
      break;
    }

    lines.push(block);
    usedChars += block.length;
  }

  return lines.join('\n\n---\n\n');
}

async function vectorSearchChunks({ collection, queryVector, category, topK, indexName }) {
  const pipeline = [
    {
      $vectorSearch: {
        index: indexName,
        path: 'embedding',
        queryVector,
        numCandidates: Math.max(topK * 10, 50),
        limit: topK,
        ...(category ? { filter: { 'metadata.category': category } } : {})
      }
    },
    {
      $project: {
        text: 1,
        metadata: 1,
        score: { $meta: 'vectorSearchScore' }
      }
    }
  ];

  return collection.aggregate(pipeline).toArray();
}

async function fallbackLocalSimilaritySearch({ collection, queryVector, category, topK }) {
  const scanLimit = toPositiveInt(process.env.RAG_FALLBACK_SCAN_LIMIT, 2000);
  const baseFilter = category ? { 'metadata.category': category } : {};

  const candidates = await collection
    .find(baseFilter, { projection: { text: 1, metadata: 1, embedding: 1 } })
    .limit(scanLimit)
    .toArray();

  const scored = [];
  for (const item of candidates) {
    if (!Array.isArray(item.embedding) || item.embedding.length === 0) continue;

    const score = cosineSimilarity(queryVector, item.embedding);
    scored.push({
      text: item.text,
      metadata: item.metadata,
      score
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

export async function retrieveRagContext(question, options = {}) {
  const collectionName = options.collectionName || DEFAULT_COLLECTION;
  const category = options.category || null;
  const embedModel = options.embedModel || DEFAULT_EMBED_MODEL;
  const topK = toPositiveInt(options.topK ?? process.env.RAG_TOP_K, 5);
  const minScore = toFloat(options.minScore ?? process.env.RAG_MIN_SCORE, 0.65);
  const maxChars = toPositiveInt(options.maxContextChars ?? process.env.RAG_MAX_CONTEXT_CHARS, 9000);
  const vectorIndexName = options.vectorIndexName || process.env.RAG_VECTOR_INDEX || 'rag_vector_index';

  const db = await getRagDb();
  const collection = db.collection(collectionName);

  const queryEmbedding = await embedText(question, embedModel);

  let chunks = [];
  let strategy = 'vector-search';

  try {
    chunks = await vectorSearchChunks({
      collection,
      queryVector: queryEmbedding,
      category,
      topK,
      indexName: vectorIndexName
    });
  } catch (error) {
    strategy = 'fallback-cosine';
    chunks = await fallbackLocalSimilaritySearch({
      collection,
      queryVector: queryEmbedding,
      category,
      topK
    });
  }

  const filtered = chunks.filter((chunk) => Number(chunk.score) >= minScore);
  const contextText = buildContextFromChunks(filtered, maxChars);

  return {
    strategy,
    chunks: filtered,
    contextText
  };
}

export async function ensureRagCollection(collectionName = DEFAULT_COLLECTION) {
  const db = await getRagDb();
  const collection = db.collection(collectionName);

  await collection.createIndex({ chunkKey: 1 }, { unique: true });
  await collection.createIndex({ 'metadata.category': 1 });
  await collection.createIndex({ 'metadata.source': 1 });

  return collection;
}

export async function upsertRagChunk({
  collectionName = DEFAULT_COLLECTION,
  chunkKey,
  text,
  metadata,
  embedding
}) {
  if (!chunkKey) {
    throw new Error('chunkKey is required for RAG upsert.');
  }

  const db = await getRagDb();
  const collection = db.collection(collectionName);

  const result = await collection.updateOne(
    { chunkKey },
    {
      $set: {
        text,
        metadata,
        embedding,
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date()
      }
    },
    { upsert: true }
  );

  return result;
}
