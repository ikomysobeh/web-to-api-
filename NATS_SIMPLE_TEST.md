# NATS Test — Simple Step by Step

---

## What we are testing

When you create a user in **pizzasys** (your auth project),
that user should automatically appear in our **bridge database**.

That is the only thing we are testing.

```
You create user in pizzasys
        ↓
pizzasys sends message to NATS
        ↓
Our bridge receives the message
        ↓
User appears in our database   ← this is the success
```

---

## Before you start — check these 3 things

**1. Is Docker running?**
Open Docker Desktop. Make sure it says "Running".

**2. Is XAMPP running?**
Open XAMPP Control Panel. Make sure Apache and MySQL are started (green).

**3. Do you have the pizzasys project?**
It should be at: `C:\xampp\htdocs\projacet\pizzasys`

---

## STEP 1 — Start the bridge (Docker)

Open a terminal in `C:\New folder` and run:

```
docker compose up --build
```

Wait until you see these lines in the output:

```
webai-nats-setup  | --- NATS setup complete ---
webai-bridge      | NATS connected
webai-bridge      | JetStream subscribed
```

If you see those lines → STOP HERE and tell me ✅

If you see any red errors → STOP HERE and copy the error for me ❌

---

## STEP 2 — Point pizzasys to our local NATS

Open this file in Notepad:
```
C:\xampp\htdocs\projacet\pizzasys\.env
```

Find these lines:
```
NATS_HOST=
NATS_PORT=
NATS_TOKEN=
```

Change them to exactly this:
```
NATS_HOST=127.0.0.1
NATS_PORT=4222
NATS_TOKEN=localdev
```

Save the file.

**Tell me when done ✅**

---

## STEP 3 — Start the pizzasys queue worker

Open a NEW terminal (keep the Docker one open).

Go to the pizzasys folder:
```
cd C:\xampp\htdocs\projacet\pizzasys
```

Run:
```
php artisan queue:listen --tries=3
```

You should see:
```
Starting Laravel queue worker
```

Keep this terminal open. Do not close it.

**Tell me when done ✅**

---

## STEP 4 — Get a login token from pizzasys

Open Postman and send this request:

```
POST  http://localhost/projacet/pizzasys/public/api/v1/auth/login
```

Body (JSON):
```json
{
  "email": "your-admin-email@example.com",
  "password": "your-password"
}
```

You will get back a token like:
```json
{
  "token": "1|abcdef123456..."
}
```

Copy that token. You need it in the next step.

**Tell me when you have the token ✅**
(You don't need to share the token with me — just tell me you have it)

---

## STEP 5 — Create a test user in pizzasys

In Postman, send this request:

```
POST  http://localhost/projacet/pizzasys/public/api/v1/users
```

Headers:
```
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json
```

Body (JSON):
```json
{
  "name": "NATS Test User",
  "email": "natstest@example.com",
  "password": "password123",
  "roles": ["user"]
}
```

You should get back a response with the new user's `id`.

Write down that `id` number. You need it in Step 6.

**Tell me the id number you got ✅**

---

## STEP 6 — Check if the user appeared in our database

Open a new terminal and run this command:

```
docker exec -it webai-postgres psql -U webai_user -d webai_bridge -c "SELECT id, email, role, external_id, synced_at FROM users WHERE external_id IS NOT NULL ORDER BY synced_at DESC LIMIT 5;"
```

You should see the user you just created:
```
 id | email                  | role | external_id | synced_at
----+------------------------+------+-------------+-----------
  1 | natstest@example.com   | user |     42      | 2026-06-11
```

If you see the user → **SUCCESS! NATS is working** ✅

If the table is empty → tell me and we will debug ❌

---

## STEP 7 — Crash test (proves JetStream works)

This is the most important test.

**7a.** Stop the bridge:
```
docker compose stop bridge
```

**7b.** Create 2 more users in pizzasys (repeat Step 5 with different emails).
Example:
- `natstest2@example.com`
- `natstest3@example.com`

**7c.** Start the bridge again:
```
docker compose start bridge
```

**7d.** Wait 10 seconds, then run the check from Step 6 again.

If both new users appear → **JetStream is working** ✅
(Messages were saved while bridge was off, then delivered when it came back)

If they don't appear → tell me ❌

---

## Summary — what success looks like

```
✅ Step 1 — Docker starts, NATS connected message appears
✅ Step 2 — pizzasys .env updated
✅ Step 3 — queue worker running
✅ Step 4 — you have a login token
✅ Step 5 — you created a test user, you have the id
✅ Step 6 — that user appears in our PostgreSQL database
✅ Step 7 — crash test works, missed users replay after restart
```

When all 7 are green → NATS is fully working and ready for production.

---

## If something goes wrong

Tell me:
1. Which step number failed
2. Copy the error message you see
3. I will tell you the fix

Do not skip steps. Do them in order.
