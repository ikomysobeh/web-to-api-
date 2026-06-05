# PostgreSQL Setup Instructions

## Prerequisites
You need PostgreSQL installed on your system. If you don't have it, download from: https://www.postgresql.org/download/windows/

## Setup Steps

### 1. Create Database and User

Open PostgreSQL command line (psql) or pgAdmin and run:

```sql
-- Create database
CREATE DATABASE webai_bridge;

-- Create user with password
CREATE USER postgres WITH PASSWORD 'postgres';

-- Grant all privileges on the database
GRANT ALL PRIVILEGES ON DATABASE webai_bridge TO postgres;

-- Exit
\q
```

### 2. Update .env if needed

Your `.env` file already has:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/webai_bridge
```

If you used different credentials, update this line accordingly.

### 3. Verify Connection

The bridge will automatically create the required tables (`users`, `user_gemini_cookies`) on startup via the `init_db()` function.

### 4. Alternative: Using pgAdmin

If you prefer pgAdmin:
1. Open pgAdmin and connect to your server
2. Right-click on "Databases" → Create → Database
3. Name it `webai_bridge`
4. Right-click on "Login/Group Roles" → Create → Login/Role
5. Name it `postgres`, set password to `postgres`
6. Right-click on the new database → Properties → Privileges
7. Grant all privileges to the `postgres` role

## Troubleshooting

If you get "connection refused":
- Make sure PostgreSQL service is running
- Check the port (default is 5432)
- Verify the password in .env matches what you set

If you get "database does not exist":
- Run the CREATE DATABASE command above
- Check the DATABASE_URL in .env matches the database name
