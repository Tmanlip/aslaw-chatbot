# ASLAW Chatbot - Chat Storage Schema

## Overview
Chats are stored in MongoDB collection `chatbot-question-answer` with strict schema validation. Every chat document **must** contain `question`, `answers`, and `model` fields.

---

## MongoDB Schema Validation

### Required Fields
- **`question`** (string, required)
  - The user's legal question

- **`answers`** (string, required)
  - The model-generated legal answer/response

- **`model`** (string, required, enum)
  - The ASLAW model used for this chat
  - **Valid values:**
    - `aslaw-civil`
    - `aslaw-corporate`
    - `aslaw-criminal`
    - `aslaw-general`

### Optional Fields
- **`category`** (string, optional, enum)
  - Category of the question
  - **Valid values:** `civil`, `corporate`, `criminal`, `general`

- **`createdAt`** (date, optional)
  - Timestamp when the chat was created
  - Auto-set to current date if not provided

- **`updatedAt`** (date, optional)
  - Timestamp when the chat was last updated
  - Auto-set to current date if not provided

---

## API Endpoints

### 1. Ask & Save Chat (Combined)
**POST** `/ask`

Save a response automatically by including `saveChat: true` in the request.

**Request Body:**
```json
{
  "question": "What are the requirements for a valid marriage contract in Malaysia?",
  "saveChat": true
}
```

**Response:**
```json
{
  "answer": "A valid marriage contract in Malaysia must...",
  "category": "civil",
  "model": "aslaw-civil",
  "chatId": "507f1f77bcf86cd799439011",
  "saved": true
}
```

---

### 2. Save Chat (Standalone)
**POST** `/save-chat`

Manually save a chat document with full control over all fields.

**Request Body:**
```json
{
  "question": "What penalties apply to copyright infringement?",
  "answers": "Copyright infringement penalties in Malaysia include...",
  "model": "aslaw-general",
  "category": "general"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Chat saved successfully",
  "chatId": "507f1f77bcf86cd799439012"
}
```

**Error (Schema Validation Failure):**
```json
{
  "error": "Chat must have question, answers, and model fields"
}
```

---

### 3. Retrieve Chats
**GET** `/chats?model=aslaw-civil&category=civil&limit=10`

Query stored chats with optional filtering.

**Query Parameters:**
- `model` (optional) - Filter by ASLAW model
- `category` (optional) - Filter by legal category
- `limit` (optional, default: 10) - Maximum number of results

**Response:**
```json
{
  "count": 3,
  "chats": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "question": "What is a marriage contract?",
      "answers": "A marriage contract is...",
      "model": "aslaw-civil",
      "category": "civil",
      "createdAt": "2026-03-20T10:30:00Z",
      "updatedAt": "2026-03-20T10:30:00Z"
    },
    {
      "_id": "507f1f77bcf86cd799439012",
      "question": "What are divorce procedures?",
      "answers": "Divorce procedures in Malaysia...",
      "model": "aslaw-civil",
      "category": "civil",
      "createdAt": "2026-03-20T11:15:00Z",
      "updatedAt": "2026-03-20T11:15:00Z"
    }
  ]
}
```

---

## Database Health Check
**GET** `/db-health`

Check MongoDB and PostgreSQL connection status and schema validation setup.

**Response:**
```json
{
  "mongodb": {
    "configured": true,
    "connected": true,
    "error": null
  },
  "postgresql": {
    "configured": true,
    "connected": true,
    "error": null
  }
}
```

---

## Usage Examples

### Example 1: Ask a question and auto-save
```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is a power of attorney in Malaysian law?",
    "saveChat": true
  }'
```

### Example 2: Manual save with all fields
```bash
curl -X POST http://localhost:3000/save-chat \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Explain corporate tax obligations",
    "answers": "Corporate tax obligations in Malaysia include...",
    "model": "aslaw-corporate",
    "category": "corporate"
  }'
```

### Example 3: Retrieve civil law chats
```bash
curl http://localhost:3000/chats?model=aslaw-civil&category=civil&limit=5
```

---

## Schema Validation Rules
- **Strict validation** is enabled: documents that don't match the schema **cannot be inserted**
- **Error action**: Invalid inserts will throw a validation error
- If a chat is missing `question`, `answers`, or `model`, the insert will be rejected
- The `model` field must be one of the 4 ASLAW models

---

## Notes for Training
- Every chat includes the model that generated it (for monitoring model performance)
- Timestamps allow tracking of chat history and trends
- Category classification helps organize chats by legal domain
- Failed validations indicate data quality issues - check request format

---

## Modify Schema
To add or modify required fields, edit the `setupChatValidation()` function in `database.js` and restart the server.
