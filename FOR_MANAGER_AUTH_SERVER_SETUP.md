# Auth Server Configuration Guide
## For the Manager / Server Admin of authtesting.lcportal.cloud

**Prepared by:** WebAI Bridge Team  
**Date:** 2026-06-27  
**Urgency:** Required for the WebAI system to work in production

---

## What is the WebAI project?

We have two separate systems that must work together:

| System | Server | What it does |
|--------|--------|--------------|
| **Auth System (Pizzasys)** | authtesting.lcportal.cloud (your server) | Manages users, login, and roles |
| **WebAI Bridge** | AI VPS — 2.25.70.122 | AI chat system that uses your users |

When a user is created, updated, or deleted in the Auth System, the WebAI Bridge must be notified automatically so it can keep its own database in sync. This notification happens through a messaging system called **NATS**.

---

## The Problem

Your auth server has its own NATS server (used by multiple projects).  
The WebAI Bridge on the AI VPS is listening to its own separate NATS.  
They are not connected — so events never arrive at the WebAI Bridge.

```
YOUR SERVER (authtesting.lcportal.cloud)         AI VPS (2.25.70.122)
────────────────────────────────────────         ─────────────────────
  Pizzasys publishes event
       │
       ▼
  auth-nats ──▶ other project A ✓               webai-nats (empty)
            ──▶ other project B ✓                    │
                                                     ▼
                                               Bridge gets nothing ✗
```

---

## The Fix — No changes to your server

**We do NOT change the auth server's NATS settings.**  
Changing them would affect all other projects connected to it.

Instead, the **WebAI Bridge will connect TO your auth-nats** as an additional subscriber — read-only, it only listens and never publishes.

```
YOUR SERVER (authtesting.lcportal.cloud)         AI VPS (2.25.70.122)
────────────────────────────────────────         ─────────────────────
  Pizzasys publishes event
       │
       ▼
  auth-nats ──▶ other project A ✓ (unchanged)
            ──▶ other project B ✓ (unchanged)
            ──▶ WebAI Bridge     ✓ (new — read-only subscriber)
```

Other projects are completely unaffected. The bridge simply joins as one more listener.

---

## What we need from you (3 things)

We only need information — **no code or config changes on your server**.

### 1. Your NATS connection details

Please provide:

| Info needed | Example | Your value |
|---|---|---|
| NATS host / IP | `authtesting.lcportal.cloud` or an IP | |
| NATS port | `4222` (default) | |
| NATS token | the token set in your NATS config | |

> The WebAI team will put these values into the AI VPS config. Nothing changes on your server.

### 2. Firewall access

The AI VPS (`2.25.70.122`) needs to be allowed to connect to your NATS port (usually `4222`).

Please add a firewall rule on your server:
```
Allow inbound TCP on port 4222 from IP: 2.25.70.122
```

If your NATS already listens on a public interface, this may already work — but please confirm.

### 3. CORS — Allow the WebAI frontend origin

The WebAI frontend (`http://2.25.70.122:3000`) calls your server directly from the browser for **login** and the **Users list page**.

For these to work, your server must allow that origin in its CORS configuration.

In Pizzasys, open `config/cors.php` and make sure `http://2.25.70.122:3000` is in the `allowed_origins` list:

```php
'allowed_origins' => [
    'http://2.25.70.122:3000',
    // ... other origins already there
],
```

Or if Pizzasys reads CORS from `.env`:

```env
CORS_ALLOWED_ORIGINS=http://2.25.70.122:3000
```

Then clear the config cache:
```bash
php artisan config:clear
```

> **Why:** Without this, the browser blocks login requests with a CORS error and users cannot log in to the WebAI system.

---

## Summary

| | Action needed | Who does it |
|---|---|---|
| Auth server NATS config | ❌ No changes | — |
| Auth server code / logic | ❌ No changes | — |
| Other connected projects | ❌ No impact | — |
| User data / database | ❌ No changes | — |
| Firewall — allow `2.25.70.122` on NATS port | ✅ One firewall rule | Auth server admin |
| CORS — allow `http://2.25.70.122:3000` | ✅ One config line | Auth server admin |
| Provide NATS connection details | ✅ Share info only | Auth server admin |
| AI VPS config update | ✅ Done by WebAI team | WebAI team |

---

## After you share the NATS details

The WebAI team will:
1. Update the AI VPS config to connect to your NATS
2. Restart the WebAI Bridge
3. Confirm with you that user events are being received

No further action needed on your side after providing the info.

---

## Contact

If you have any questions, please contact the WebAI team.
