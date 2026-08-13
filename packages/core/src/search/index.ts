/**
 * Search Module
 *
 * Full-text search for EmDash:
 * - SQLite FTS5 MATCH queries with BM25 relevance scoring when an
 *   `_emdash_fts_<collection>` virtual table exists
 * - Case-insensitive LIKE fallback when the FTS5 table is not configured
 *   (Postgres, search enabled before the index is built, missing table)
 */

// Types
export type {
	SearchConfig,
	SearchTokenizer,
	SearchOptions,
	CollectionSearchOptions,
	SearchResult,
	SearchResponse,
	SuggestOptions,
	Suggestion,
	SearchStats,
} from "./types.js";
export { SEARCH_TOKENIZERS } from "./types.js";

// FTS Manager
export { FTSManager } from "./fts-manager.js";

// Query functions (public API uses getDb() internally)
export { search, searchWithDb, searchCollection, getSuggestions, getSearchStats } from "./query.js";

// Text extraction
export { extractPlainText, extractSearchableFields } from "./text-extraction.js";

// Match / LIKE helpers
export { buildFtsPrefixMatch, buildSlugGlobPrefix, escapeLikePattern } from "./match.js";
