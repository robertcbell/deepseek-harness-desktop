---
name: db-sentinel
description: Database inspection, schema discovery, SQL execution, and Row Level Security (RLS) auditing for PostgreSQL and Supabase databases.
---

# 🗄️ Database Sentinel Plugin

Direct database inspection and SQL execution tool for PostgreSQL and Supabase.

## 🛠️ CLI Interface & Invocations

Executable: `bun ~/.dsh/scripts/db_sentinel.mjs <action> <DATABASE_URL> [arguments]`

### 1. Inspect Database Schema
List all tables, columns, data types, and nullability:
```bash
bun ~/.dsh/scripts/db_sentinel.mjs inspect "$DATABASE_URL"
```

### 2. Inspect Row Level Security (RLS) Status
Check which tables have RLS enabled:
```bash
bun ~/.dsh/scripts/db_sentinel.mjs rls "$DATABASE_URL"
```

### 3. Execute Custom SQL Query
Run queries and return tab-delimited records:
```bash
bun ~/.dsh/scripts/db_sentinel.mjs query "$DATABASE_URL" "SELECT count(*) FROM users;"
```
