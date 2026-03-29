import { MongoClient } from 'mongodb';
import pg from 'pg';

const { Pool } = pg;

const dbHealth = {
  mongodb: {
    configured: false,
    connected: false,
    error: null
  },
  postgresql: {
    configured: false,
    connected: false,
    error: null
  }
};

let mongoClient = null;
let mongoDb = null;
let postgresPool = null;
const DEFAULT_CHAT_COLLECTION = 'chatbot-question-answer';

function sanitizeFirmId(firmID) {
  if (!firmID) return null;
  const raw = String(firmID).trim();
  if (!raw) return null;
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getCollectionNameByFirm(firmID) {
  const safeFirmID = sanitizeFirmId(firmID);
  return safeFirmID ? `chat_${safeFirmID}` : DEFAULT_CHAT_COLLECTION;
}

async function collectionExists(collectionName) {
  if (!mongoDb) {
    throw new Error('MongoDB is not connected.');
  }

  const cursor = mongoDb.listCollections({ name: collectionName }, { nameOnly: true });
  return cursor.hasNext();
}

function getChatValidatorSchema() {
  return {
    $jsonSchema: {
      bsonType: 'object',
      required: ['question', 'answers', 'model'],
      properties: {
        _id: { bsonType: 'objectId' },
        question: {
          bsonType: 'string',
          description: 'User question - must be a string'
        },
        answers: {
          bsonType: 'string',
          description: 'Generated answer from the model - must be a string'
        },
        model: {
          bsonType: 'string',
          enum: ['aslaw-civil', 'aslaw-corporate', 'aslaw-criminal', 'aslaw-general'],
          description: 'Model used for this chat - must be one of the ASLAW models'
        },
        category: {
          bsonType: 'string',
          enum: ['civil', 'corporate', 'criminal', 'general'],
          description: 'Category of the question (optional)'
        },
        firmID: {
          bsonType: 'string',
          description: 'Firm ID of the logged in user (optional)'
        },
        createdAt: {
          bsonType: 'date',
          description: 'Timestamp when chat was created (optional)'
        },
        updatedAt: {
          bsonType: 'date',
          description: 'Timestamp when chat was last updated (optional)'
        }
      }
    }
  };
}

async function ensureChatCollectionValidation(collectionName) {
  if (!mongoDb) {
    throw new Error('MongoDB is not connected.');
  }

  try {
    await mongoDb.command({
      collMod: collectionName,
      validator: getChatValidatorSchema(),
      validationLevel: 'strict',
      validationAction: 'error'
    });
  } catch (error) {
    if (error.codeName === 'NamespaceNotFound') {
      await mongoDb.createCollection(collectionName, {
        validator: getChatValidatorSchema(),
        validationLevel: 'strict',
        validationAction: 'error'
      });
      console.log(`Created chats collection with schema validation: ${collectionName}`);
    } else {
      console.error(`Error setting up chat validation (${collectionName}):`, error.message);
    }
  }
}

export async function initializeDatabases() {
  const mongoUri = process.env.MONGODB_URI;
  const mongoDbName = process.env.MONGODB_DB || 'aslaw';
  const postgresUrl = process.env.POSTGRES_URL;

  if (mongoUri) {
    dbHealth.mongodb.configured = true;

    try {
      mongoClient = new MongoClient(mongoUri);
      await mongoClient.connect();
      mongoDb = mongoClient.db(mongoDbName);
      await mongoDb.command({ ping: 1 });
      await setupChatValidation();
      dbHealth.mongodb.connected = true;
      dbHealth.mongodb.error = null;
      console.log(`MongoDB connected (${mongoDbName})`);
    } catch (error) {
      dbHealth.mongodb.connected = false;
      dbHealth.mongodb.error = error.message;
      console.error('MongoDB connection failed:', error.message);
    }
  } else {
    console.warn('MongoDB skipped: set MONGODB_URI to enable it.');
  }

  if (postgresUrl) {
    dbHealth.postgresql.configured = true;

    try {
      postgresPool = new Pool({ connectionString: postgresUrl });
      await postgresPool.query('SELECT 1');
      dbHealth.postgresql.connected = true;
      dbHealth.postgresql.error = null;
      console.log('PostgreSQL connected');
    } catch (error) {
      dbHealth.postgresql.connected = false;
      dbHealth.postgresql.error = error.message;
      console.error('PostgreSQL connection failed:', error.message);
    }
  } else {
    console.warn('PostgreSQL skipped: set POSTGRES_URL to enable it.');
  }
}

export function getDatabaseHealth() {
  return structuredClone(dbHealth);
}

export function getMongoDb() {
  if (!mongoDb) {
    throw new Error('MongoDB is not connected.');
  }

  return mongoDb;
}

export function getPostgresPool() {
  if (!postgresPool) {
    throw new Error('PostgreSQL is not connected.');
  }

  return postgresPool;
}

/**
 * Set up MongoDB schema validation for the chats collection.
 * Ensures all chat documents follow the required structure.
 */
export async function setupChatValidation() {
  if (!mongoDb) {
    throw new Error('MongoDB is not connected.');
  }

  await ensureChatCollectionValidation(DEFAULT_CHAT_COLLECTION);
  console.log(`MongoDB schema validation set for chats collection: ${DEFAULT_CHAT_COLLECTION}`);
}

/**
 * Save a chat document to MongoDB with validation.
 * @param {Object} chatData - { question, answers, model, category, createdAt, updatedAt }
 * @returns {Object} Result with insertedId
 */
export async function saveChat(chatData, options = {}) {
  if (!mongoDb) {
    throw new Error('MongoDB is not connected.');
  }

  const { firmID } = options;
  const collectionName = getCollectionNameByFirm(firmID);
  await ensureChatCollectionValidation(collectionName);
  const chatsCollection = mongoDb.collection(collectionName);
  
  // Ensure required fields are present
  if (!chatData.question || !chatData.answers || !chatData.model) {
    throw new Error('Chat must have question, answers, and model fields');
  }

  // Add timestamps if not provided
  const documentToInsert = {
    ...chatData,
    ...(firmID ? { firmID: String(firmID) } : {}),
    createdAt: chatData.createdAt || new Date(),
    updatedAt: chatData.updatedAt || new Date()
  };

  const result = await chatsCollection.insertOne(documentToInsert);
  return result;
}

/**
 * Find chats by question or model.
 * @param {Object} query - MongoDB query object
 * @returns {Array} Array of chat documents
 */
export async function findChats(query = {}, options = {}) {
  if (!mongoDb) {
    throw new Error('MongoDB is not connected.');
  }

  const { firmID } = options;
  const collectionName = getCollectionNameByFirm(firmID);

  // For internal firm collections: if it does not exist yet, return empty list.
  if (firmID) {
    const exists = await collectionExists(collectionName);
    if (!exists) {
      return [];
    }
  }

  const chatsCollection = mongoDb.collection(collectionName);
  const chats = await chatsCollection.find(query).toArray();
  return chats;
}
