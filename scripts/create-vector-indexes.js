import 'dotenv/config';
import { MongoClient } from 'mongodb';

async function main() {
  const uri = process.env.RAG_MONGODB_URI || process.env.MONGODB_URI;
  const dbName = process.env.RAG_MONGODB_DB || process.env.MONGODB_DB || 'aslaw';
  const indexName = process.env.RAG_VECTOR_INDEX || 'rag_vector_index';

  if (!uri) {
    throw new Error('Missing MongoDB URI in env');
  }

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db(dbName);

    for (const colName of ['civil', 'criminal']) {
      const col = db.collection(colName);

      // Check if index already exists
      try {
        if (typeof col.listSearchIndexes !== 'function') {
          console.log(`${colName}: Search indexes not supported by this MongoDB deployment`);
          continue;
        }

        const existing = await col.listSearchIndexes().toArray();
        if (existing.some((idx) => idx.name === indexName)) {
          console.log(`${colName}: Vector index "${indexName}" already exists`);
          continue;
        }
      } catch (e) {
        console.log(`${colName}: Could not check existing indexes:`, e.message);
        continue;
      }

      // Get embedding dimension from a sample document
      const sample = await col.findOne({ embedding: { $exists: true, $type: 'array' } });
      if (!sample || !Array.isArray(sample.embedding)) {
        console.log(`${colName}: No embedded documents found, skipping index creation`);
        continue;
      }

      const dimensions = sample.embedding.length;
      console.log(`${colName}: Creating vector index with ${dimensions} dimensions...`);

      try {
        await col.createSearchIndex({
          name: indexName,
          definition: {
            mappings: {
              dynamic: false,
              fields: {
                embedding: {
                  type: 'knnVector',
                  dimensions,
                  similarity: 'cosine'
                },
                'metadata.category': { type: 'token' },
                'metadata.source': { type: 'token' }
              }
            }
          }
        });

        console.log(`${colName}: Vector index "${indexName}" created successfully`);
      } catch (error) {
        if (String(error.message).includes('already exists')) {
          console.log(`${colName}: Vector index already exists`);
        } else {
          console.error(`${colName}: Error creating index:`, error.message);
        }
      }
    }

    console.log('---');
    console.log('Vector index creation complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Vector index setup failed:', error.message);
  process.exit(1);
});
