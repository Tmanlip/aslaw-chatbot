import 'dotenv/config';
import { MongoClient } from 'mongodb';

async function main() {
  const uri = process.env.RAG_MONGODB_URI || process.env.MONGODB_URI;
  const dbName = process.env.RAG_MONGODB_DB || process.env.MONGODB_DB || 'aslaw';

  if (!uri) {
    throw new Error('Missing MongoDB URI in env');
  }

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db(dbName);
    console.log(`DB: ${dbName}`);

    for (const colName of ['civil', 'criminal']) {
      const col = db.collection(colName);
      const total = await col.countDocuments();
      const civilCount = await col.countDocuments({ 'metadata.category': 'civil' });
      const criminalCount = await col.countDocuments({ 'metadata.category': 'criminal' });

      const sources = await col
        .aggregate([
          { $group: { _id: '$metadata.source' } },
          { $limit: 5 }
        ])
        .toArray();

      let searchIndexes = [];
      if (typeof col.listSearchIndexes === 'function') {
        try {
          const listed = await col.listSearchIndexes().toArray();
          searchIndexes = listed.map((item) => item.name);
        } catch {
          searchIndexes = [];
        }
      }

      console.log('---');
      console.log(`Collection: ${colName}`);
      console.log(`Total: ${total}`);
      console.log(`Category civil: ${civilCount}`);
      console.log(`Category criminal: ${criminalCount}`);
      console.log(`Sample sources: ${sources.map((s) => s._id).filter(Boolean).join(' | ') || '(none)'}`);
      console.log(`Search indexes: ${searchIndexes.join(', ') || '(none)'}`);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Status check failed:', error.message);
  process.exit(1);
});
