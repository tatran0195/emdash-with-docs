/**
 * Minimal `bun:sqlite` types so the Node typecheck can compile the
 * optional Bun driver path without a bun-types dependency.
 */
declare module "bun:sqlite" {
	export class Database {
		constructor(filename: string, options?: { readonly?: boolean; create?: boolean });
		close(): void;
		prepare(sql: string): Statement;
	}

	export class Statement {
		all(...params: unknown[]): unknown[];
		run(...params: unknown[]): { changes?: number; lastInsertRowid?: number | bigint };
		iterate(...params: unknown[]): IterableIterator<unknown>;
	}
}
