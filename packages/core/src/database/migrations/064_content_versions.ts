import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Version catalog for hierarchical collections.
 * Extra columns on ec_* are created by SchemaRegistry when a collection
 * has supports: ["hierarchical"].
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("_emdash_content_versions")
		.ifNotExists()
		.addColumn("id", "text", (col) => col.primaryKey())
		.addColumn("collection", "text", (col) => col.notNull())
		.addColumn("slug", "text", (col) => col.notNull())
		.addColumn("label", "text", (col) => col.notNull())
		.addColumn("is_default", "integer", (col) => col.notNull().defaultTo(0))
		.addColumn("is_frozen", "integer", (col) => col.notNull().defaultTo(0))
		.addColumn("sort_order", "integer", (col) => col.notNull().defaultTo(0))
		.addColumn("created_at", "text", (col) => col.notNull())
		.addUniqueConstraint("content_versions_collection_slug", ["collection", "slug"])
		.execute();

	await sql`
		CREATE INDEX IF NOT EXISTS idx_content_versions_collection
		ON _emdash_content_versions (collection, sort_order)
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("_emdash_content_versions").ifExists().execute();
}
