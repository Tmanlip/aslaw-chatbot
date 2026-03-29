# ASLAW Chatbot - Dual Interface Guide

This chatbot framework now includes two separate interfaces designed for different user types.

## 🌐 Public View
**Location:** `/` (root path)  
**File:** `public/index.html`

### Features:
- **Clean, Simple Interface** - Minimalist design focused on chatting
- **Easy Access** - No authentication required
- **Basic Functionality**:
  - Ask Malaysian legal questions
  - View responses with category classification
  - Real-time typing indicators
  - Responsive design for mobile and desktop

### Access:
```
http://localhost:3000/
```

### Best For:
- Regular users seeking legal information
- Quick queries about Malaysian law
- Simple, distraction-free experience

---

## 🔐 Internal View (Dashboard)
**Location:** `/internal/`  
**File:** `internal/index.html`

### Features:
- **Advanced Dashboard** - Professional interface for internal users
- **Sidebar Navigation** - Multiple sections and tools
- **Core Sections**:

#### 1. **Chat with Bot**
   - Same chat functionality as public view
   - Enhanced styling for professional use
   - Response time tracking
   - Auto-save to local storage option

#### 2. **Statistics Dashboard** 📊
   - Total queries count
   - Today's query statistics
   - Average response time
   - Top category analysis
   - Category breakdown visualization
   - Real-time stats update

#### 3. **Chat History** 📜
   - View all previous conversations
   - Search and manage chat history
   - Delete individual items or clear all
   - Timestamp for each conversation
   - Quick reference to categories

#### 4. **Settings & Administration** ⚙️
   - User role display
   - Auto-save toggle
   - Show response time option
   - Model preference selection
   - Query timeout configuration
   - **Data Management**:
     - 📥 Export chat history (JSON)
     - 📥 Export statistics (CSV)
     - 📤 Import data (coming soon)

### Access:
```
http://localhost:3000/internal/
```

### Best For:
- Internal team members
- Training and evaluation purposes
- Monitoring chatbot performance
- Data analysis and reporting
- Quality assurance

---

## 🔄 Switching Between Views

### From Public to Internal:
- Direct browser URL: `http://localhost:3000/internal/`
- Users can manually navigate

### From Internal to Public:
- Direct browser URL: `http://localhost:3000/`
- Quick reference link available on server status page

---

## 💾 Data Storage

### Local Storage (Client-side):
Internal view uses browser's localStorage to persist:
- Chat history
- User statistics
- Settings preferences

**Note:** Data is stored locally and will persist across browser sessions until cleared.

### Database Storage:
If configured, chat data can also be saved to:
- MongoDB
- PostgreSQL
- Via the `/save-chat` endpoint

---

## 📋 Configuration

### Server Routes:
- `GET /` - Server status (links to both views)
- `GET /internal/` - Internal dashboard
- `POST /ask` - Chat endpoint (used by both views)
- `POST /save-chat` - Save chat to database
- `GET /chats` - Retrieve saved chats
- `GET /db-health` - Database health check

### Environment Variables:
Required in `.env`:
```
OLLAMA_HOST=http://localhost:11434
MONGODB_URI=mongodb://localhost:27017
POSTGRES_URI=postgresql://user:password@localhost:5432/aslaw
```

---

## 🚀 Running the Server

```bash
npm install
node server.js
```

Then access:
- **Public:** `http://localhost:3000/`
- **Internal:** `http://localhost:3000/internal/`

---

## 🎨 Customization

### Public View (`public/index.html`):
- Modify gradient colors in `:root` CSS
- Adjust header text and branding
- Change placeholder text for input field

### Internal View (`internal/index.html`):
- Add more stat cards in the stats grid
- Customize sidebar menu items with `switchView()` function
- Modify export formats in `exportChatHistory()` and `exportStatistics()`

---

## 🔒 Security Considerations

### Public View:
- No authentication by default
- Safe for external users
- Input is sanitized with `escapeHtml()` function

### Internal View:
- Should be protected with authentication in production
- Recommend adding login/password protection
- Add access control middleware (consider JWT tokens)
- Current protection: Basic client-side role indication

### Recommended Production Setup:
```javascript
// Add authentication middleware
app.use('/internal', (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
});
```

---

## 📊 Export Formats

### Chat History Export (JSON):
```json
[
  {
    "question": "What is the Federal Constitution?",
    "answer": "The Federal Constitution...",
    "category": "Constitutional Law",
    "timestamp": "3/28/2026, 2:30:45 PM",
    "responseTime": 1024
  }
]
```

### Statistics Export (CSV):
```csv
Category,Count
Constitutional Law,15
Criminal Law,23
Civil Law,18
```

---

## 🛠️ Troubleshooting

### Internal view not loading:
1. Check that `internal/` folder exists
2. Verify server is running: `http://localhost:3000/`
3. Clear browser cache and reload
4. Check browser console for errors (F12)

### Chat not working in either view:
1. Ensure Ollama is running: `http://localhost:11434`
2. Check server logs for errors
3. Verify `/ask` endpoint is accessible
4. Check network tab in browser dev tools

### Statistics not showing:
1. localStorage might be disabled in browser
2. Try clearing site data and reload
3. Check browser settings for privacy mode

---

## 📝 Notes

- Both views share the same `/ask` endpoint
- The internal view is more feature-rich but non-essential
- Public view is lean and loads faster
- All chat data in internal view is client-side by default
- To persist data permanently, enable database save options

---

**Version:** 1.0.0  
**Last Updated:** March 28, 2026
