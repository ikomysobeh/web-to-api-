# How to Create an Admin User — PostgreSQL Beginner Guide

No prior PostgreSQL experience needed. Follow the steps in order.

---

## Step 1 — Make sure the containers are running

Open a terminal and run:

```bash
docker compose up --build
```

Wait until you see this line in the output:
```
webai-bridge-1  | INFO:     Application startup complete.
```

Leave that terminal running. Open a **second terminal** for the steps below.

---

## Step 2 — Register a new account through the website

Open your browser and go to:
```
http://localhost:3000
```

Click **Sign up** (or Register) and create an account with any email and password.
Example:
- Email: `admin@lumina.com`
- Password: `admin123`

> You can also use your existing `kamidan@gmail.com` account — skip this step and use
> that email in Step 4 instead.

---

## Step 3 — Open the PostgreSQL database

PostgreSQL is running inside Docker. To talk to it, run this command in your terminal:

```bash
docker exec -it webai-postgres psql -U webai_user -d webai_bridge
```

What each part means:
- `docker exec -it webai-postgres` — go inside the running postgres container
- `psql` — the PostgreSQL command-line tool (like a database console)
- `-U webai_user` — login as the database user named `webai_user`
- `-d webai_bridge` — open the database named `webai_bridge`

You will see a prompt like this:
```
webai_bridge=#
```

This means you are now inside the database. You can type SQL commands here.

---

## Step 4 — See all users in the database

Type this command and press Enter:

```sql
SELECT id, email, role FROM users;
```

You will see a table like this:
```
 id |        email         | role
----+----------------------+------
  1 | kamidan@gmail.com    | user
  2 | admin@lumina.com     | user
(2 rows)
```

> Every account starts with `role = user`. We need to change one to `admin`.

---

## Step 5 — Promote your account to admin

Replace the email below with your email, then press Enter:

```sql
UPDATE users SET role = 'admin' WHERE email = 'admin@lumina.com';
```

You should see:
```
UPDATE 1
```

`UPDATE 1` means exactly 1 row was changed. That is correct.

If you see `UPDATE 0` — the email you typed does not match anything in the database.
Go back to Step 4, copy the exact email from the table, and try again.

---

## Step 6 — Confirm the change worked

Run this again to double-check:

```sql
SELECT id, email, role FROM users;
```

You should now see:
```
 id |        email         | role
----+----------------------+-------
  1 | kamidan@gmail.com    | user
  2 | admin@lumina.com     | admin
(1 row)
```

---

## Step 7 — Exit the database console

Type this and press Enter:

```sql
\q
```

The `\q` command quits psql and returns you to your normal terminal.

---

## Step 8 — Log in and see the Admin Panel

1. Go to `http://localhost:3000`
2. Log in with the admin email and password
3. Look at the left sidebar — you will see a **purple "Admin Panel"** button with a shield icon

> If you were already logged in with that account, press **Ctrl+Shift+R** (hard refresh)
> instead of logging out. The page will re-check your role from the server automatically.

---

## Cheat Sheet — Useful psql Commands

Once you are inside psql (`webai_bridge=#`), you can run these at any time:

| Command | What it does |
|---|---|
| `SELECT id, email, role FROM users;` | See all users and their roles |
| `UPDATE users SET role='admin' WHERE email='x@x.com';` | Make someone admin |
| `UPDATE users SET role='user' WHERE email='x@x.com';` | Remove admin |
| `SELECT * FROM agents;` | See all AI agents |
| `SELECT * FROM user_agents;` | See all agent assignments |
| `\dt` | List all tables in the database |
| `\q` | Quit / exit psql |

> Every SQL command must end with a semicolon `;` — if you press Enter without one,
> psql waits for more input. Just type `;` and press Enter to finish.

---

## Optional — Use a GUI Instead of the Terminal

If you prefer clicking over typing, install **TablePlus** (free tier is enough):
- Download: https://tableplus.com

Connection settings:
- Type: **PostgreSQL**
- Host: `127.0.0.1`
- Port: `5432`
- User: `webai_user`
- Password: whatever is in your `.env` file as `DB_PASSWORD` (default: `change_me_please`)
- Database: `webai_bridge`

TablePlus gives you a spreadsheet-like view of all tables and lets you edit rows by clicking.

---

## Troubleshooting

**"docker: Error response from daemon: No such container: webai-postgres"**
→ The containers are not running. Go back to Step 1.

**"psql: FATAL: password authentication failed"**
→ The username is wrong. Make sure you typed `-U webai_user` exactly.

**"UPDATE 0" after the UPDATE command**
→ The email doesn't match. Check the exact email with `SELECT id, email, role FROM users;`

**Admin Panel button still not visible after logging in**
→ Press Ctrl+Shift+R (hard refresh). If still not visible, log out and log back in.

**"role column does not exist"**
→ The backend hasn't run the migration yet. Make sure the bridge container started
  successfully (`docker compose up --build`) before running psql commands.
