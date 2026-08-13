---
"emdash": minor
---

Public search now falls back to case-insensitive LIKE (with escaped wildcards and sanitized `<mark>` snippets) when an FTS5 virtual table is not configured. Enabling search on non-SQLite dialects marks the collection searchable instead of throwing, so Postgres sites get working search without FTS5.

Breaks the `emdash` ↔ `@emdash-cms/auth-atproto` workspace cycle by dropping the unused optional peer from core — the plugin still peers on the host, which is the correct direction.
