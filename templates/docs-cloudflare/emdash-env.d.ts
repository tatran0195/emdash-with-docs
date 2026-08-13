/// <reference types="emdash/locals" />

import type { PortableTextBlock } from "emdash";

export interface Doc {
	id: string;
	slug: string | null;
	status: string;
	title: string;
	content?: PortableTextBlock[];
	path?: string;
	parentId?: string | null;
	nodeKind?: "doc" | "section";
	versionSlug?: string;
	createdAt: Date;
	updatedAt: Date;
	publishedAt: Date | null;
}

declare module "emdash" {
	interface EmDashCollections {
		docs: Doc;
	}
}
