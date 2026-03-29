import 'dotenv/config';
import { BlobServiceClient } from '@azure/storage-blob';
import { MongoClient } from 'mongodb';

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.json', '.pdf']);

function buildConnectionString() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return process.env.AZURE_STORAGE_CONNECTION_STRING;
  }

  const name = process.env.AZURE_STORAGE_NAME;
  const key = process.env.AZURE_STORAGE_KEY;

  if (!name || !key) {
    throw new Error('Missing Azure credentials in env.');
  }

  return `DefaultEndpointsProtocol=https;AccountName=${name};AccountKey=${key};EndpointSuffix=core.windows.net`;
}

function normalizePath(input) {
  return String(input || '').replace(/\\/g, '/').trim();
}

function hasSupportedExt(name) {
  const lower = String(name || '').toLowerCase();
  return [...SUPPORTED_EXTENSIONS].some((ext) => lower.endsWith(ext));
}

async function listCriminalBlobs() {
  const connectionString = buildConnectionString();
  const containerName = process.env.AZURE_STORAGE_CONTAINER;
  const prefix = process.env.CRIMINAL_AZURE_PREFIX || 'RAG/criminal/';

  if (!containerName) {
    throw new Error('AZURE_STORAGE_CONTAINER is required.');
  }

  const containerClient = BlobServiceClient
    .fromConnectionString(connectionString)
    .getContainerClient(containerName);

  const names = [];
  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    if (!hasSupportedExt(blob.name)) continue;
    names.push(normalizePath(blob.name));
  }

  return {
    prefix,
    names
  };
}

async function listCriminalMongoSources() {
  const uri = process.env.RAG_MONGODB_URI || process.env.MONGODB_URI;
  const dbName = process.env.RAG_MONGODB_DB || process.env.MONGODB_DB || 'aslaw';

  if (!uri) {
    throw new Error('Missing Mongo URI in env.');
  }

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const collection = client.db(dbName).collection('criminal');
    const sources = await collection.aggregate([
      { $match: { 'metadata.source': { $exists: true, $type: 'string' } } },
      { $group: { _id: '$metadata.source', chunks: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray();

    return {
      dbName,
      sources: sources.map((item) => ({
        source: normalizePath(item._id),
        chunks: item.chunks
      }))
    };
  } finally {
    await client.close();
  }
}

async function main() {
  const [{ prefix, names: blobNames }, { dbName, sources }] = await Promise.all([
    listCriminalBlobs(),
    listCriminalMongoSources()
  ]);

  const blobSet = new Set(blobNames);
  const mongoMap = new Map(sources.map((item) => [item.source, item.chunks]));
  const mongoSet = new Set(mongoMap.keys());

  const missingInMongo = blobNames.filter((name) => !mongoSet.has(name));
  const extraInMongo = [...mongoSet].filter((name) => !blobSet.has(name));

  console.log('Azure prefix:', prefix);
  console.log('Mongo DB:', dbName);
  console.log('Azure criminal docs:', blobNames.length);
  console.log('Mongo criminal unique sources:', sources.length);
  console.log('---');

  if (missingInMongo.length === 0) {
    console.log('Missing in Mongo: none');
  } else {
    console.log('Missing in Mongo:');
    for (const item of missingInMongo) {
      console.log('-', item);
    }
  }

  console.log('---');

  if (extraInMongo.length === 0) {
    console.log('Extra in Mongo: none');
  } else {
    console.log('Extra in Mongo:');
    for (const item of extraInMongo) {
      console.log('-', item);
    }
  }

  console.log('---');
  console.log('Per-source chunk counts:');
  for (const item of sources) {
    console.log(`- ${item.source}: ${item.chunks}`);
  }
}

main().catch((error) => {
  console.error('Completeness check failed:', error.message);
  process.exit(1);
});
