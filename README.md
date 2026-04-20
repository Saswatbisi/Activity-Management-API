# 🚀 Activity Management API — Scalable Activity Engine

A production-ready **Activity Management API** built with Node.js that handles high-traffic registrations with **Redis Caching**, **WebSocket notifications**, **Worker Thread PDF generation**, and **race-condition-safe seat booking**.

**MeetMux Capstone Project — Node.js Backend Track**

---

## 📋 Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Setup & Installation](#-setup--installation)
- [API Endpoints](#-api-endpoints)
- [Key Features Deep Dive](#-key-features-deep-dive)
- [Testing](#-testing)
- [Project Structure](#-project-structure)

---

## ✨ Features

| Feature | Technology | Description |
|---------|-----------|-------------|
| **Redis Caching** | Redis Cloud | Cache-aside pattern for activity list with auto-invalidation |
| **WebSockets** | Socket.io | Live "User Joined" notifications with JWT auth |
| **Worker Threads** | Node.js Worker Threads + PDFKit | Non-blocking PDF ticket generation |
| **Race Condition Handling** | Redis WATCH/MULTI/EXEC | Optimistic locking prevents double-booking at the exact same millisecond |
| **JWT Authentication** | jsonwebtoken + bcrypt | Secure auth with hashed passwords |
| **RESTful API** | Express.js + MongoDB | Full CRUD for activities with pagination |

---

## 🛠 Tech Stack

```
Runtime:       Node.js
Framework:     Express.js
Database:      MongoDB Atlas + Mongoose
Cache:         Redis Cloud
Real-time:     Socket.io
PDF Engine:    PDFKit + Worker Threads
Auth:          JWT + bcrypt
```

---

## 🏗 Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Client     │────▶│  Express.js  │────▶│  MongoDB Atlas  │
│  (Postman)   │     │   REST API   │     │   (Database)    │
└──────┬──────┘     └──────┬───────┘     └─────────────────┘
       │                   │
       │            ┌──────┴───────┐
       │            │  Redis Cloud │ ◀── Cache-Aside Pattern
       │            │  WATCH/MULTI │ ◀── Race Condition Lock
       │            └──────────────┘
       │
       │            ┌──────────────┐
       └───────────▶│  Socket.io   │ ◀── "User Joined" Events
                    │  WebSocket   │
                    └──────────────┘
                    ┌──────────────┐
                    │   Worker     │ ◀── PDF Ticket Generation
                    │   Threads    │     (Non-blocking)
                    └──────────────┘
```

---

## 🔧 Setup & Installation

### Prerequisites
- Node.js (v18+)
- MongoDB Atlas account (or local MongoDB)
- Redis Cloud account (or local Redis)

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/activity-management-api.git
cd activity-management-api
npm install
```

### . Start the Server

```bash
# Development
npm run dev

# Production
npm start
```

---

## 📡 API Endpoints

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/auth/register` | Register a new user | ❌ |
| `POST` | `/api/auth/login` | Login user, returns JWT | ❌ |

### Activities (CRUD)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/activities` | List all activities (**Redis cached**) | ❌ |
| `GET` | `/api/activities/:id` | Get single activity | ❌ |
| `POST` | `/api/activities` | Create activity | ✅ |
| `PUT` | `/api/activities/:id` | Update activity (owner only) | ✅ |
| `DELETE` | `/api/activities/:id` | Delete activity (owner only) | ✅ |

### Registrations

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/activities/:id/register` | **Race-safe** registration | ✅ |
| `DELETE` | `/api/activities/:id/unregister` | Cancel registration | ✅ |
| `GET` | `/api/activities/:id/ticket` | Download PDF ticket | ✅ |

---

## 🔍 Key Features Deep Dive

### 1. Redis Caching (Cache-Aside Pattern)

```
GET /api/activities
    ├─▶ Check Redis key "activities:all"
    ├─▶ Cache HIT  → Return cached JSON instantly (source: "cache")
    └─▶ Cache MISS → Query MongoDB → Store in Redis (60s TTL) → Return (source: "database")

POST/PUT/DELETE /api/activities
    └─▶ Invalidate Redis key "activities:all"
```

### 2. Race Condition Handling (Redis WATCH/MULTI/EXEC)

When two users try to grab the **last spot at the exact same millisecond**:

```
User A                          User B
  │                               │
  ├─ WATCH seats_key ────────────┤─ WATCH seats_key
  ├─ GET seats = 4               ├─ GET seats = 4
  ├─ 4 < 5? ✅ Proceed          ├─ 4 < 5? ✅ Proceed
  ├─ MULTI                       ├─ MULTI
  │    INCR seats_key            │    INCR seats_key
  ├─ EXEC ──▶ SUCCESS ✅         ├─ EXEC ──▶ NULL ❌ (conflict!)
  │           seats = 5          │
  │                              ├─ RETRY LOOP
  │                              ├─ GET seats = 5
  │                              ├─ 5 >= 5? ❌ FULL!
  │                              └─ Return 409: "Activity is full"
```

### 3. WebSocket — Live Notifications

```javascript
// Client connects with JWT
const socket = io('ws://localhost:3000', {
  auth: { token: 'your_jwt_token' }
});

// Join an activity room
socket.emit('join-activity-room', 'activity_id');

// Listen for live updates
socket.on('user-joined', (data) => {
  // { user: { name, email }, currentParticipants, availableSpots, timestamp }
});

socket.on('activity-full', (data) => {
  // { activityId, title, message, timestamp }
});
```

### 4. Worker Threads — PDF Ticket Generation

- Tickets generated in a **separate thread** (non-blocking)
- Uses **PDFKit** for professional-looking tickets
- Includes: Activity title, date, location, attendee name, ticket ID
- Stored in `/tickets/` directory
- Download via `GET /api/activities/:id/ticket`

---

## 🧪 Testing

### Race Condition Test

```bash
# With the server running
node test-race-condition.js
```

This creates 5 users, an activity with 1 spot, and fires **all 5 registrations simultaneously**. Only 1 should succeed.

### Manual Testing with cURL

```bash
# 1. Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"John","email":"john@test.com","password":"test123"}'

# 2. Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@test.com","password":"test123"}'

# 3. Create Activity (use token from login)
curl -X POST http://localhost:3000/api/activities \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Workshop","description":"Learn Node.js","date":"2026-05-15","location":"Bangalore","maxParticipants":5}'

# 4. Register for Activity
curl -X POST http://localhost:3000/api/activities/ACTIVITY_ID/register \
  -H "Authorization: Bearer YOUR_TOKEN"

# 5. Download Ticket
curl -O http://localhost:3000/api/activities/ACTIVITY_ID/ticket \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 📁 Project Structure

```
activity-management-api/
├── server.js                    # Entry point — wires Express, MongoDB, Redis, Socket.io
├── package.json
├── .env                         # Environment configuration
├── .gitignore
├── test-race-condition.js       # Race condition stress test
│
├── config/
│   ├── db.js                    # MongoDB connection (Mongoose)
│   ├── redis.js                 # Redis client + cache helpers (with in-memory fallback)
│   └── socket.js                # Socket.io setup with JWT auth middleware
│
├── middleware/
│   └── auth.js                  # JWT authentication middleware
│
├── models/
│   ├── User.js                  # User model (bcrypt password hashing)
│   └── Activity.js              # Activity model (virtual: availableSpots)
│
├── routes/
│   ├── auth.js                  # POST /register, /login
│   ├── activities.js            # GET/POST/PUT/DELETE /activities (Redis cached)
│   └── registrations.js         # POST /register, DELETE /unregister, GET /ticket
│
├── workers/
│   └── pdfWorker.js             # Worker thread for PDF ticket generation
│
└── tickets/                     # Generated PDF tickets (gitignored)
```
---

## 👤 Author
**Saswat Bisi** — MeetMux Capstone Project, 2026

