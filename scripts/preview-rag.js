import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initializeDatabases } from '../database.js';
import { embedText, getRagDb } from '../rag.js';

function parseArgs(argv) {
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const value = argv[i + 1];

    if (!value || value.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = value;
      i += 1;
    }
  }

  return options;
}

function normalizeWhitespace(input) {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkTextByChars(text, chunkSize, overlap) {
  const chunks = [];
  let start = 0;
  const cleanText = normalizeWhitespace(text);

  if (!cleanText) return chunks;

  while (start < cleanText.length) {
    const end = Math.min(start + chunkSize, cleanText.length);
    const chunk = cleanText.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= cleanText.length) break;
    start = Math.max(end - overlap, 0);
  }

  return chunks;
}

function printVector(name, vector) {
  console.log(`\n${name}`);
  console.log(`- length: ${vector.length}`);
  console.log(`- first 12 dims: [${vector.slice(0, 12).map((n) => n.toFixed(6)).join(', ')}]`);
}

function shortText(text, max = 220) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}...`;
}

async function previewCollection(collectionName) {
  const db = await getRagDb();
  const collection = db.collection(collectionName);

  const total = await collection.countDocuments();
  console.log(`\nCollection preview: ${collectionName}`);
  console.log(`- total documents: ${total}`);

  if (total === 0) {
    console.log('- no embedded chunks found yet');
    return;
  }

  const sample = await collection.findOne({}, {
    projection: {
      text: 1,
      metadata: 1,
      embedding: 1
    }
  });

  if (!sample) {
    console.log('- unable to load sample document');
    return;
  }

  console.log('- sample metadata:', sample.metadata || {});
  console.log(`- sample text: ${shortText(sample.text)}`);

  if (Array.isArray(sample.embedding)) {
    printVector('Stored embedding sample', sample.embedding);
  } else {
    console.log('- sample has no embedding field');
  }
}

async function previewFromText(text, embedModel) {
  const input = normalizeWhitespace(text);
  if (!input) return;

  console.log('\nText embedding preview');
  console.log(`- input: ${shortText(input, 180)}`);

  const vector = await embedText(input, embedModel);
  printVector('Generated embedding', vector);
}

async function previewFromFile(filePath, embedModel, chunkSize, overlap, maxChunks) {
  const absPath = path.resolve(filePath);
  const raw = await fs.readFile(absPath, 'utf-8');
  const chunks = chunkTextByChars(raw, chunkSize, overlap).slice(0, maxChunks);

  console.log(`\nChunking preview: ${absPath}`);
  console.log(`- chunks generated (preview): ${chunks.length}`);

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    console.log(`\nChunk #${i}`);
    console.log(`- text: ${shortText(chunk, 180)}`);

    const vector = await embedText(chunk, embedModel);
    printVector(`Embedding for chunk #${i}`, vector);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const collectionName = args.collection || process.env.RAG_COLLECTION || 'criminal';
  const embedModel = args.embedModel || process.env.RAG_EMBED_MODEL || 'nomic-embed-text';
  const inputText = args.text || '';
  const filePath = args.file || '';
  const chunkSize = Number.parseInt(args.chunkSize || process.env.RAG_CHUNK_SIZE || '3500', 10);
  const overlap = Number.parseInt(args.overlap || process.env.RAG_CHUNK_OVERLAP || '600', 10);
  const maxChunks = Number.parseInt(args.maxChunks || '2', 10);

  await initializeDatabases();
  await previewCollection(collectionName);

  if (inputText) {
    await previewFromText(inputText, embedModel);
  }

  if (filePath) {
    await previewFromFile(filePath, embedModel, chunkSize, overlap, maxChunks);
  }

  console.log('\nPreview complete.');
}

main().catch((error) => {
  console.error('Preview failed:', error.message);
  process.exit(1);
});
