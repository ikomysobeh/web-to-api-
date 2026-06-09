# WebAI Bridge Backend Documentation

> Complete backend documentation for the webai-bridge Python FastAPI application.
> This middleware bridges the React frontend with the WebAI-to-API Gemini service.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Architecture](#architecture)
4. [Database Schema](#database-schema)
5. [API Endpoints](#api-endpoints)
6. [Authentication System](#authentication-system)
7. [Cookie Management](#cookie-management)
8. [WebAI-to-API Integration](#webai-to-api-integration)
9. [Configuration](#configuration)
10. [Security](#security)
11. [Deployment](#deployment)
12. [Development Guide](#development-guide)

---

## Project Overview

**Purpose:** Acts as middleware between the React frontend (web2api-ui) and the WebAI-to-API Gemini service.

**Key Responsibilities:**
- User authentication (register/login/logout)
- JWT token management
- Per-user Gemini cookie management (encrypted storage)
- Chat streaming proxy to WebAI-to-API
- Multi-user session isolation
- Browser cookie extraction (local deployment)

**Project Structure:**
```
webai-bridge/
├── main.py                 # FastAPI application & routes
├── auth.py                 # JWT authentication & password hashing
├── database.py             # PostgreSQL connection & table creation
├── models.py               # Data classes (User, UserGeminiCookie)
├── requirements.txt        # Python dependencies
├── services/
│   └── cookie_service.py   # Cookie encryption/decryption service
├── Dockerfile              # Container configuration
├── .env                    # Environment variables (gitignored)
└── POSTGRESQL_SETUP.md     # Database setup guide
```

---

## Tech Stack

### Core Framework
- **FastAPI 0.136.3** - Modern Python web framework with automatic OpenAPI docs
- **Uvicorn 0.49.0** - ASGI server for running FastAPI

### Database
- **PostgreSQL** - Primary database for user data and cookies
- **psycopg2-binary 2.9.10** - PostgreSQL adapter for Python

### Authentication
- **python-jose[cryptography] 3.3.0** - JWT token creation/verification
- **passlib[bcrypt] 1.7.4** - Password hashing with bcrypt
- **bcrypt 4.1.3** - Bcrypt algorithm implementation

### HTTP Client
- **httpx 0.28.1** - Async HTTP client for WebAI-to-API communication

### Security
- **pycryptodomex 3.23.0** - Cryptography library for cookie encryption
- **python-dotenv 1.2.2** - Environment variable management

### Browser Integration
- **browser-cookie3 0.20.1** - Extract cookies from local browsers

### Validation
- **pydantic 2.13.4** - Data validation and settings management

---

## Architecture

### Request Flow

```
React Frontend (localhost:3000)
         ↓
    HTTP Request (JWT token in Authorization header)
         ↓
FastAPI Application (localhost:8000)
         ↓
    Authentication Check (get_current_user)
         ↓
    Business Logic (auth, cookies, chat)
         ↓
    PostgreSQL Database (user data, encrypted cookies)
         ↓
    WebAI-to-API (localhost:6969)
         ↓
    Gemini Service (via WebAI-to-API)
         ↓
    Streaming Response (SSE) back to Frontend
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **main.py** | Route definitions, request handling, WebAI-to-API proxy |
| **auth.py** | JWT token creation/verification, password hashing/verification |
| **database.py** | PostgreSQL connection management, table initialization |
| **models.py** | Data class definitions for type safety |
| **cookie_service.py** | Cookie encryption/decryption, CRUD operations |
| **WebAI-to-API** | Gemini client management, chat completion API |

---

## Database Schema

### Tables

#### `users`
Stores user account information.

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Fields:**
- `id` - Auto-incrementing primary key
- `email` - User email (unique, case-insensitive)
- `password_hash` - Bcrypt hashed password
- `created_at` - Account creation timestamp

#### `user_gemini_cookies`
Stores encrypted Gemini cookies per user.

```sql
CREATE TABLE user_gemini_cookies (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL,
    psid_encrypted TEXT NOT NULL,
    psidts_encrypted TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**Fields:**
- `id` - Auto-incrementing primary key
- `user_id` - Foreign key to users table (unique - one cookie set per user)
- `psid_encrypted` - Fernet-encrypted `__Secure-1PSID` cookie
- `psidts_encrypted` - Fernet-encrypted `__Secure-1PSIDTS` cookie
- `created_at` - Cookie creation timestamp
- `updated_at` - Last update timestamp

**Security Note:** Cookies are never stored in plain text. All cookie values are encrypted using Fernet symmetric encryption before database insertion.

---

## API Endpoints

### Authentication Endpoints

#### POST `/auth/register`
Create a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response (201):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "email": "user@example.com"
}
```

**Validation:**
- Email must be valid format and not already registered
- Password must be at least 6 characters
- Email is stored in lowercase

**Error Responses:**
- `422` - Invalid email or password too short
- `409` - Email already registered

---

#### POST `/auth/login`
Authenticate user and return JWT token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "email": "user@example.com"
}
```

**Security Note:** Does not reveal which part (email or password) is incorrect to prevent user enumeration.

**Error Responses:**
- `401` - Invalid email or password

---

#### GET `/auth/me`
Get current user information.

**Headers:**
```
Authorization: Bearer {token}
```

**Response (200):**
```json
{
  "user_id": 1,
  "email": "user@example.com"
}
```

**Error Responses:**
- `401` - Not authenticated or invalid token

---

### Cookie Management Endpoints

#### POST `/api/cookies`
Manually save Gemini cookies for the authenticated user.

**Headers:**
```
Authorization: Bearer {token}
```

**Request Body:**
```json
{
  "psid": "your_psid_value_here",
  "psidts": "your_psidts_value_here"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Gemini connected successfully"
}
```

**Process:**
1. Validates cookie length (minimum 10 characters)
2. Encrypts cookies using Fernet
3. Saves encrypted cookies to database
4. Calls WebAI-to-API to create Gemini client for this user
5. Returns success message

**Error Responses:**
- `422` - Cookie values too short
- `500` - Database or WebAI-to-API error

---

#### POST `/api/cookies/extract`
Automatically extract Gemini cookies from browser.

**Headers:**
```
Authorization: Bearer {token}
```

**Query Parameters:**
- `browser` (optional, default: "chrome") - Browser to extract from
  - Allowed values: `chrome`, `firefox`, `brave`, `edge`, `safari`

**Response (200) - Success:**
```json
{
  "success": true,
  "message": "Cookies found and applied automatically"
}
```

**Response (200) - Not Logged In:**
```json
{
  "success": false,
  "message": "Not logged into gemini.google.com",
  "action_needed": "login"
}
```

**Response (200) - Extraction Failed:**
```json
{
  "success": false,
  "message": "Extraction failed: {error details}",
  "action_needed": "manual"
}
```

**Process:**
1. Validates browser parameter
2. Uses `browser-cookie3` to read cookies from browser
3. Searches for `__Secure-1PSID` and `__Secure-1PSIDTS`
4. If found, saves to database and creates WebAI client
5. Returns appropriate status message

**Note:** Only works when backend runs on the same machine as the browser (local deployment).

**Error Responses:**
- `400` - Unknown browser specified

---

#### GET `/api/cookies/status`
Check if user has Gemini cookies saved.

**Headers:**
```
Authorization: Bearer {token}
```

**Response (200):**
```json
{
  "connected": true,
  "message": "Gemini connected"
}
```

**Or:**
```json
{
  "connected": false,
  "message": "No Gemini session found"
}
```

---

#### DELETE `/api/cookies`
Disconnect Gemini by removing cookies.

**Headers:**
```
Authorization: Bearer {token}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Gemini disconnected"
}
```

**Process:**
1. Deletes cookies from database
2. Calls WebAI-to-API to remove user's Gemini client from memory

---

### Chat Endpoint

#### POST `/api/chat`
Stream chat completion through WebAI-to-API.

**Headers:**
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "message": "Hello, how are you?",
  "model": "gemini-3-flash"
}
```

**Response:** Server-Sent Events (SSE) stream

**Stream Format:**
```
data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}

data: {"choices":[{"delta":{"content":"!"},"index":0}]}

data: [DONE]
```

**Process:**
1. Validates user is authenticated
2. Constructs request body for WebAI-to-API
3. Adds `X-Internal-User-ID` header to identify user's Gemini client
4. Streams response from WebAI-to-API to frontend
5. Handles errors and streams error messages

**Headers in Response:**
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- `X-Accel-Buffering: no` (disable nginx buffering)

**Error Handling:**
- If WebAI-to-API returns non-200 status, error is streamed in SSE format
- Network errors are caught and streamed as error messages

---

### Health Check

#### GET `/health`
Service health check.

**Response (200):**
```json
{
  "status": "ok",
  "service": "webai-bridge"
}
```

---

## Authentication System

### JWT Token Structure

**Algorithm:** HS256
**Secret Key:** From `SECRET_KEY` environment variable
**Expiration:** 7 days (168 hours)

**Token Payload:**
```json
{
  "sub": "1",           // User ID (subject)
  "email": "user@example.com",
  "exp": 1750000000    // Expiration timestamp
}
```

### Password Hashing

**Algorithm:** Bcrypt
**Cost Factor:** Default (12 rounds)
**Limit:** 72 bytes (bcrypt limitation)

**Implementation Details:**
- Passwords are truncated to 72 bytes before hashing (bcrypt limit)
- UTF-8 characters are handled properly (no mid-character truncation)
- Uses `passlib` library with bcrypt scheme

### Authentication Flow

```
1. Registration
   User sends email + password
   → Password hashed with bcrypt
   → User record created in database
   → JWT token generated
   → Token returned to user

2. Login
   User sends email + password
   → User fetched from database
   → Password verified against hash
   → JWT token generated
   → Token returned to user

3. Protected Route Access
   Frontend sends token in Authorization header
   → Token decoded and verified
   → User existence checked in database
   → User data injected into route handler
```

### Dependency Injection

FastAPI's `Depends()` is used for authentication:

```python
@app.get("/protected")
def protected_route(user = Depends(get_current_user)):
    # user = {"user_id": 1, "email": "user@example.com"}
    return {"message": f"Hello, {user['email']}"}
```

The `get_current_user` function:
1. Extracts token from `Authorization: Bearer {token}` header
2. Verifies token signature and expiration
3. Checks user still exists in database
4. Returns user data or raises 401 exception

---

## Cookie Management

### Encryption

**Algorithm:** Fernet (AES-128 in CBC mode with HMAC)
**Key Source:** `COOKIE_ENCRYPTION_KEY` environment variable

**Key Preparation:**
```python
_raw_key = os.getenv("COOKIE_ENCRYPTION_KEY", "").encode()
_padded = (_raw_key + b"0" * 32)[:32]  # Pad/truncate to 32 bytes
_fernet_key = base64.urlsafe_b64encode(_padded)
_fernet = Fernet(_fernet_key)
```

**Security Note:** In production, generate a proper Fernet key:
```python
from cryptography.fernet import Fernet
key = Fernet.generate_key()  # Use this in .env
```

### Cookie Service Functions

#### `save_cookies(user_id, psid, psidts)`
Encrypts and saves cookies to database. Updates if already exists.

#### `load_cookies(user_id)`
Loads and decrypts cookies from database. Returns `(psid, psidts)` tuple or `None`.

#### `has_cookies(user_id)`
Checks if user has cookies saved. Returns boolean.

#### `delete_cookies(user_id)`
Deletes cookies from database.

### WebAI-to-API Client Management

The bridge manages per-user Gemini clients in WebAI-to-API:

#### `create_webai_client_for_user(user_id, psid, psidts)`
Calls WebAI-to-API internal endpoint to create a Gemini client for a specific user.

**Endpoint:** `POST {WEBAI_URL}/internal/gemini/create`
**Headers:** `X-Internal-Key: {WEBAI_INTERNAL_KEY}`
**Body:** `{"user_id": str(user_id), "psid": psid, "psidts": psidts}`

#### `remove_webai_client_for_user(user_id)`
Calls WebAI-to-API to remove a user's Gemini client from memory.

**Endpoint:** `DELETE {WEBAI_URL}/internal/gemini/{user_id}`
**Headers:** `X-Internal-Key: {WEBAI_INTERNAL_KEY}`

---

## WebAI-to-API Integration

### Configuration

Environment variables:
- `WEBAI_URL` - WebAI-to-API base URL (default: `http://localhost:6969`)
- `WEBAI_INTERNAL_KEY` - Internal API key for WebAI-to-API
- `WEBAI_CONFIG_PATH` - Path to WebAI-to-API config file (default: `../WebAI-to-API/config.conf`)

### Chat Streaming

The bridge proxies chat requests to WebAI-to-API with user identification:

**Request to WebAI-to-API:**
```http
POST {WEBAI_URL}/v1/chat/completions
Content-Type: application/json
X-Internal-Key: {WEBAI_INTERNAL_KEY}
X-Internal-User-ID: {user_id}

{
  "model": "gemini-3-flash",
  "stream": true,
  "messages": [
    {"role": "user", "content": "user message"}
  ]
}
```

**Response:** Streamed back to frontend via SSE

### Config File Management

The bridge can write cookies to WebAI-to-API's config file (legacy method):

**Function:** `write_cookies_to_config(psid, psidts)`

**Process:**
1. Reads config file using `configparser`
2. Updates `[Gemini]` section with cookie values
3. Sets `backend = "webapi"` and `default_model = "gemini-3-flash"`
4. Writes back to file

**Note:** This is the old method. New method uses per-user client management via internal API.

---

## Configuration

### Environment Variables

Create a `.env` file in the `webai-bridge` directory:

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/webai_bridge

# JWT Authentication
SECRET_KEY=your-secret-key-here-change-in-production

# WebAI-to-API Integration
WEBAI_URL=http://localhost:6969
WEBAI_INTERNAL_KEY=your-internal-key-here
WEBAI_CONFIG_PATH=../WebAI-to-API/config.conf

# Cookie Encryption
COOKIE_ENCRYPTION_KEY=your-32-byte-encryption-key
```

### CORS Configuration

**Allowed Origins:** `http://localhost:3000` (React frontend)
**Allowed Methods:** All
**Allowed Headers:** All
**Credentials:** Enabled

To add more origins, modify in `main.py`:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://yourdomain.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Logging

**Level:** INFO
**Format:** `%(asctime)s | %(levelname)s | %(message)s`
**Logger Name:** `webai-bridge`

Logs include:
- Registration attempts (success/failure)
- Login attempts (success/failure)
- Cookie save operations
- Cookie extraction results
- Chat requests
- WebAI-to-API communication
- Errors with stack traces

---

## Security

### Authentication Security

1. **Password Hashing**
   - Bcrypt with automatic salt generation
   - 72-byte limit handled properly
   - No plain text storage

2. **JWT Tokens**
   - HS256 algorithm
   - 7-day expiration
   - Secret key from environment
   - User existence verification on each request

3. **Input Validation**
   - Pydantic models for request validation
   - Email format validation
   - Password length validation
   - Cookie length validation

### Data Security

1. **Cookie Encryption**
   - Fernet symmetric encryption
   - Never stored in plain text
   - Encryption key from environment
   - Per-user isolation

2. **Database Security**
   - Parameterized queries (SQL injection prevention)
   - Foreign key constraints
   - Unique constraints on email
   - User isolation via user_id

3. **API Security**
   - All protected routes require authentication
   - User can only access their own data
   - Internal API key for WebAI-to-API communication
   - CORS restrictions

### Best Practices

1. **Environment Variables**
   - Never commit `.env` file
   - Use strong random keys in production
   - Rotate keys periodically

2. **Error Handling**
   - Don't reveal sensitive information in errors
   - Generic error messages for authentication failures
   - Log errors server-side only

3. **Rate Limiting** (Not yet implemented)
   - Consider adding rate limiting for:
     - Registration endpoint
     - Login endpoint
     - Chat endpoint

---

## Deployment

### Local Development

1. **Install Dependencies**
   ```bash
   cd webai-bridge
   pip install -r requirements.txt
   ```

2. **Set Up PostgreSQL**
   - Follow `POSTGRESQL_SETUP.md`
   - Create database `webai_bridge`
   - Create user with privileges

3. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

4. **Run Server**
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

5. **Access API Docs**
   - Swagger UI: http://localhost:8000/docs
   - ReDoc: http://localhost:8000/redoc

### Docker Deployment

**Dockerfile:**
```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Build and Run:**
```bash
cd webai-bridge
docker build -t webai-bridge .
docker run -p 8000:8000 --env-file .env webai-bridge
```

### Docker Compose

**docker-compose.yml** (in project root):
```yaml
version: '3.8'

services:
  webai-bridge:
    build: ./webai-bridge
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/webai_bridge
      - SECRET_KEY=${SECRET_KEY}
      - WEBAI_URL=http://webai-to-api:6969
      - WEBAI_INTERNAL_KEY=${WEBAI_INTERNAL_KEY}
      - COOKIE_ENCRYPTION_KEY=${COOKIE_ENCRYPTION_KEY}
    depends_on:
      - db

  db:
    image: postgres:15
    environment:
      - POSTGRES_DB=webai_bridge
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

**Run:**
```bash
docker-compose up -d
```

### Production Considerations

1. **Use Production WSGI Server**
   ```bash
   gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker
   ```

2. **Environment Variables**
   - Use strong, randomly generated keys
   - Set `SECRET_KEY` to 32+ random characters
   - Set `COOKIE_ENCRYPTION_KEY` to 32+ random characters
   - Use `Fernet.generate_key()` for encryption key

3. **Database**
   - Use managed PostgreSQL service (e.g., AWS RDS, Google Cloud SQL)
   - Enable SSL connections
   - Regular backups

4. **HTTPS**
   - Use reverse proxy (nginx, Traefik)
   - Enable SSL/TLS
   - Force HTTPS redirects

5. **Monitoring**
   - Add application monitoring (e.g., Sentry, Datadog)
   - Log aggregation (e.g., ELK stack)
   - Health check endpoints

6. **Rate Limiting**
   - Implement rate limiting middleware
   - Limit per-user requests
   - DDoS protection

---

## Development Guide

### Adding New Endpoints

1. **Define Pydantic Model** (in `main.py` or separate file)
   ```python
   class NewEndpointInput(BaseModel):
       field1: str
       field2: int
   ```

2. **Create Route Handler**
   ```python
   @app.post("/api/new-endpoint", dependencies=[Depends(get_current_user)])
   def new_endpoint(data: NewEndpointInput, user = Depends(get_current_user)):
       # Your logic here
       return {"success": True}
   ```

3. **Add Database Operations** (if needed)
   ```python
   from database import get_connection
   
   conn = get_connection()
   cursor = conn.cursor()
   cursor.execute("SELECT * FROM table WHERE user_id = %s", (user["user_id"],))
   # ...
   conn.commit()
   cursor.close()
   conn.close()
   ```

### Testing

**Manual Testing with cURL:**

```bash
# Register
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Login
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Get User Info
curl -X GET http://localhost:8000/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Save Cookies
curl -X POST http://localhost:8000/api/cookies \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{"psid":"your_psid","psidts":"your_psidts"}'

# Chat (streaming)
curl -X POST http://localhost:8000/api/chat \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello","model":"gemini-3-flash"}'
```

### Debugging

1. **Enable Debug Logging**
   ```python
   logging.basicConfig(level=logging.DEBUG)
   ```

2. **Check Database**
   ```bash
   psql -U postgres -d webai_bridge
   \dt                    # List tables
   SELECT * FROM users;   # View users
   SELECT * FROM user_gemini_cookies;  # View cookies
   ```

3. **View WebAI-to-API Logs**
   - Check WebAI-to-API logs for client creation/deletion
   - Verify internal API key is correct

### Common Issues

**Issue:** "Connection refused" to PostgreSQL
**Solution:** Ensure PostgreSQL service is running and DATABASE_URL is correct

**Issue:** "Invalid token" errors
**Solution:** Check SECRET_KEY matches between token generation and verification

**Issue:** Cookie extraction fails
**Solution:** Ensure backend runs on same machine as browser, and user is logged into Gemini

**Issue:** WebAI-to-API returns 500
**Solution:** Check WebAI-to-API logs, verify WEBAI_INTERNAL_KEY is correct

---

## Recommended New Endpoints

Based on the frontend integration suggestions, the following endpoints are recommended to enhance the backend:

### Conversation Management

- `GET /api/conversations` - List user's conversations
- `POST /api/conversations` - Create new conversation
- `GET /api/conversations/{id}` - Get conversation details
- `PUT /api/conversations/{id}` - Update conversation
- `DELETE /api/conversations/{id}` - Delete conversation
- `DELETE /api/conversations` - Clear all conversations

### Message Management

- `POST /api/conversations/{id}/messages` - Send message in conversation
- `GET /api/conversations/{id}/messages` - Get conversation messages
- `DELETE /api/conversations/{id}/messages/{message_id}` - Delete message

### Model Information

- `GET /api/models` - List available Gemini models

### User Profile

- `GET /api/user/profile` - Get user profile and preferences
- `PUT /api/user/profile` - Update user preferences
- `POST /api/user/logout` - Explicit logout

### Gemini Status

- `GET /api/gemini/status` - Get Gemini connection status and available models
- `POST /api/gemini/disconnect` - Disconnect Gemini (semantic alias for DELETE /api/cookies)

**See `FRONTEND_BACKEND_INTEGRATION_SUGGESTIONS.md` for detailed specifications.**

---

## Appendix

### Database Connection String Format

```
postgresql://username:password@host:port/database
```

Example:
```
postgresql://postgres:postgres@localhost:5432/webai_bridge
```

### JWT Token Debugging

Decode a JWT token (for debugging only):
```python
from jose import jwt
token = "your_token_here"
payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
print(payload)
```

### Generate Fernet Key

```python
from cryptography.fernet import Fernet
key = Fernet.generate_key()
print(key.decode())  # Use this in .env
```

### Browser Cookie Paths

- Chrome: `~/.config/google-chrome/Default/Cookies` (Linux)
- Chrome: `~/AppData/Local/Google/Chrome/User Data/Default/Cookies` (Windows)
- Firefox: `~/.mozilla/firefox/*/cookies.sqlite` (Linux)

---

**Document Version:** 1.0  
**Last Updated:** 2026-06-08  
**Author:** Backend Documentation  
**Status:** Complete
