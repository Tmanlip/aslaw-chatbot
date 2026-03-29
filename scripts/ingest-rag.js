import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { BlobServiceClient } from '@azure/storage-blob';
import pdf from 'pdf-parse';
import { initializeDatabases } from '../database.js';
import { embedText, ensureRagCollection, upsertRagChunk, getRagDb } from '../rag.js';

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.json', '.pdf']);

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

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeWhitespace(input) {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\t ]+/g, ' ')
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

    if (end >= cleanText.length) {
      break;
    }

    start = Math.max(end - overlap, 0);
  }

  return chunks;
}

async function walkFiles(rootDir) {
  const result = [];

  async function visit(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await visit(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          result.push(fullPath);
        }
      }
    }
  }

  await visit(rootDir);
  return result;
}

function isSupportedTextPath(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

async function streamToBuffer(readable) {
  const chunks = [];

  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function parseDocumentTextByExtension(rawBuffer, ext) {
  if (ext === '.pdf') {
    const parsed = await pdf(rawBuffer);
    return parsed?.text || '';
  }

  const rawText = rawBuffer.toString('utf-8');
  if (ext === '.json') {
    return parseJsonToText(rawText);
  }

  return rawText;
}

async function listAzureTextDocuments({ connectionString, containerName, prefix = '' }) {
  if (!connectionString) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING is required for Azure source ingestion.');
  }

  if (!containerName) {
    throw new Error('AZURE_STORAGE_CONTAINER is required for Azure source ingestion.');
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  const items = [];

  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    if (!isSupportedTextPath(blob.name)) {
      continue;
    }

    const blobClient = containerClient.getBlobClient(blob.name);
    const download = await blobClient.download();
    const ext = path.extname(blob.name).toLowerCase();
    const rawBuffer = await streamToBuffer(download.readableStreamBody);
    const parsedText = await parseDocumentTextByExtension(rawBuffer, ext);

    items.push({
      source: blob.name,
      text: parsedText
    });
  }

  return items;
}

function buildAzureConnectionString({ explicitConnectionString, accountName, accountKey }) {
  if (explicitConnectionString) {
    return explicitConnectionString;
  }

  if (!accountName || !accountKey) {
    return '';
  }

  return `DefaultEndpointsProtocol=https;AccountName=${accountName};AccountKey=${accountKey};EndpointSuffix=core.windows.net`;
}

function parseJsonToText(raw) {
  try {
    const parsed = JSON.parse(raw);

    if (typeof parsed === 'string') {
      return parsed;
    }

    if (Array.isArray(parsed)) {
      return parsed.map((item) => JSON.stringify(item)).join('\n');
    }

    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

async function loadTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const rawBuffer = await fs.readFile(filePath);
  return parseDocumentTextByExtension(rawBuffer, ext);
}

function toChunkKey(source, chunkIndex, category) {
  return crypto
    .createHash('sha1')
    .update(`${category}|${source}|${chunkIndex}`)
    .digest('hex');
}

async function ensureVectorIndexIfSupported({ collectionName, dimensions, similarity = 'cosine' }) {
  const db = await getRagDb();
  const collection = db.collection(collectionName);
  const indexName = process.env.RAG_VECTOR_INDEX || 'rag_vector_index';

  if (typeof collection.createSearchIndex !== 'function') {
    return { created: false, reason: 'createSearchIndex() unavailable in current MongoDB deployment' };
  }

  try {
    await collection.createSearchIndex({
      name: indexName,
      definition: {
        mappings: {
          dynamic: false,
          fields: {
            embedding: {
              type: 'knnVector',
              dimensions,
              similarity
            },
            'metadata.category': { type: 'token' },
            'metadata.source': { type: 'token' }
          }
        }
      }
    });

    return { created: true, indexName };
  } catch (error) {
    if (String(error.message).includes('already exists')) {
      return { created: false, reason: 'index already exists', indexName };
    }

    return { created: false, reason: error.message, indexName };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const sourceType = String(args.source || process.env.RAG_SOURCE || 'local').toLowerCase();
  const docsDir = args.dir || process.env.RAG_DOCS_DIR;
  const category = args.category || process.env.RAG_CATEGORY || 'criminal';
  const collectionName = args.collection || process.env.RAG_COLLECTION || 'criminal';
  const embedModel = args.embedModel || process.env.RAG_EMBED_MODEL || 'nomic-embed-text';
  const chunkSize = toPositiveInt(args.chunkSize || process.env.RAG_CHUNK_SIZE, 3500);
  const overlap = toPositiveInt(args.overlap || process.env.RAG_CHUNK_OVERLAP, 600);
  const azureConnectionString = buildAzureConnectionString({
    explicitConnectionString: args.azureConnectionString || process.env.AZURE_STORAGE_CONNECTION_STRING,
    accountName: args.azureStorageName || process.env.AZURE_STORAGE_NAME,
    accountKey: args.azureStorageKey || process.env.AZURE_STORAGE_KEY
  });
  const azureContainer = args.azureContainer || process.env.AZURE_STORAGE_CONTAINER || 'rag';
  const azurePrefix = args.azurePrefix || process.env.AZURE_STORAGE_PREFIX || '';

  if (sourceType === 'local' && !docsDir) {
    throw new Error('Missing docs folder. Use --dir <path> or set RAG_DOCS_DIR in .env');
  }

  await initializeDatabases();
  await ensureRagCollection(collectionName);

  let documents = [];

  if (sourceType === 'azure') {
    documents = await listAzureTextDocuments({
      connectionString: azureConnectionString,
      containerName: azureContainer,
      prefix: azurePrefix
    });

    console.log(`Found ${documents.length} supported blobs in Azure container ${azureContainer}`);
  } else {
    const absoluteDir = path.resolve(docsDir);
    const files = await walkFiles(absoluteDir);

    if (files.length === 0) {
      console.warn(`No supported files found in ${absoluteDir}`);
      return;
    }

    console.log(`Found ${files.length} files in ${absoluteDir}`);

    documents = files.map((filePath) => ({
      source: path.relative(absoluteDir, filePath).replace(/\\/g, '/'),
      filePath
    }));
  }

  if (documents.length === 0) {
    console.warn('No supported documents found for ingestion.');
    return;
  }

  let inserted = 0;
  let updated = 0;
  let totalChunks = 0;
  let vectorDimensions = null;

  for (const document of documents) {
    console.log(`Starting ${document.source} ...`);

    const sourceText = document.filePath
      ? await loadTextFromFile(document.filePath)
      : String(document.text || '');

    const chunks = chunkTextByChars(sourceText, chunkSize, overlap);

    if (chunks.length === 0) {
      console.log(`Skipped ${document.source} (no extractable text)`);
      continue;
    }

    const source = document.source;

    for (let i = 0; i < chunks.length; i += 1) {
      const chunkText = chunks[i];
      const embedding = await embedText(chunkText, embedModel);

      if (!vectorDimensions) {
        vectorDimensions = embedding.length;
      }

      const chunkKey = toChunkKey(source, i, category);
      const metadata = {
        category,
        source,
        chunkIndex: i
      };

      const result = await upsertRagChunk({
        collectionName,
        chunkKey,
        text: chunkText,
        metadata,
        embedding
      });

      if (result.upsertedCount > 0) {
        inserted += 1;
      } else if (result.modifiedCount > 0 || result.matchedCount > 0) {
        updated += 1;
      }

      totalChunks += 1;
    }

    console.log(`Processed ${source} (${chunks.length} chunks)`);
  }

  if (vectorDimensions) {
    const indexInfo = await ensureVectorIndexIfSupported({
      collectionName,
      dimensions: vectorDimensions,
      similarity: 'cosine'
    });

    if (indexInfo.created) {
      console.log(`Vector index ready: ${indexInfo.indexName}`);
    } else {
      console.log(`Vector index note: ${indexInfo.reason}`);
    }
  }

  console.log('Ingestion complete.');
  console.log(`Chunks processed: ${totalChunks}`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Updated: ${updated}`);
}

main().catch((error) => {
  console.error('RAG ingestion failed:', error.message);
  process.exit(1);
});
