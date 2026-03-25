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

  try {
    // Create or update collection with schema validation
    await mongoDb.command({
      collMod: 'chatbot-question-answer',
      validator: {
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
      },
      validationLevel: 'strict',
      validationAction: 'error'
    });
    console.log('MongoDB schema validation set for chats collection');
  } catch (error) {
    // Collection might not exist yet, create it
    if (error.codeName === 'NamespaceNotFound') {
      const collection = await mongoDb.createCollection('chatbot-question-answer', {
        validator: {
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
        },
        validationLevel: 'strict',
        validationAction: 'error'
      });
      console.log('Created chats collection with schema validation');
    } else {
      console.error('Error setting up chat validation:', error.message);
    }
  }
}

/**
 * Save a chat document to MongoDB with validation.
 * @param {Object} chatData - { question, answers, model, category, createdAt, updatedAt }
 * @returns {Object} Result with insertedId
 */
export async function saveChat(chatData) {
  if (!mongoDb) {
    throw new Error('MongoDB is not connected.');
  }

  const chatsCollection = mongoDb.collection('chatbot-question-answer');
  
  // Ensure required fields are present
  if (!chatData.question || !chatData.answers || !chatData.model) {
    throw new Error('Chat must have question, answers, and model fields');
  }

  // Add timestamps if not provided
  const documentToInsert = {
    ...chatData,
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
export async function findChats(query = {}) {
  if (!mongoDb) {
    throw new Error('MongoDB is not connected.');
  }

  const chatsCollection = mongoDb.collection('chatbot-question-answer');
  const chats = await chatsCollection.find(query).toArray();
  return chats;
}
