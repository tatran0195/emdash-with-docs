import { Badge, Button, Dialog, DropdownMenu, Input, Loader, Select, Tabs } from "@cloudflare/kumo";
import {
	DndContext,
	DragOverlay,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	defaultDropAnimationSideEffects,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragMoveEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import type { DropAnimation } from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLingui } from "@lingui/react/macro";
import {
	ArrowCounterClockwise,
	ArrowLineLeft,
	ArrowLineRight,
	ArrowSquareOut,
	CaretDown,
	CaretRight,
	CaretUp,
	Copy,
	DotsSixVertical,
	DotsThree,
	FilePlus,
	FileText,
	Folder,
	FolderPlus,
	MagnifyingGlass,
	Pencil,
	Plus,
	Trash,
} from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import * as React from "react";

import type { ContentVersion, DocTreeNode, TrashedContentItem } from "../lib/api";
import { contentUrl } from "../lib/url.js";
import { cn } from "../lib/utils";
import { getLocaleDir } from "../locales/config.js";
import {
	type FlatTreeNode,
	type TreeMove,
	type TreeProjection,
	TREE_INDENT_PX,
	applyTreeMove,
	collectMatchAncestorIds,
	countTreeNodes,
	filterTree,
	flattenVisible,
	getProjection,
	planIndent,
	planMoveFromProjection,
	planOutdent,
	planReorder,
} from "./content-tree-ops.js";
import { ContentStatusBadge, isContentStatusState } from "./ContentStatusBadge.js";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { RouterLinkButton } from "./RouterLinkButton.js";

export interface ContentTreeProps {
	collection: string;
	collectionLabel: string;
	tree: DocTreeNode[];
	isLoading?: boolean;
	trashedItems?: TrashedContentItem[];
	isTrashedLoading?: boolean;
	trashedCount?: number;
	onDelete?: (id: string) => void;
	onDuplicate?: (id: string) => void;
	onRestore?: (id: string) => void;
	onPermanentDelete?: (id: string) => void;
	/** Reorder one sibling group. `parentId` is a translation group or null. */
	onReorder?: (parentId: string | null, ids: string[]) => void;
	/** Move a node (reparent and/or reorder). Prefer this over `onReorder`. */
	onMove?: (move: TreeMove) => void;
	i18n?: { defaultLocale: string; locales: string[] };
	activeLocale?: string;
	onLocaleChange?: (locale: string) => void;
	urlPattern?: string;
	/** Version catalog for collections with `supports: ["versioned"]`. */
	versioned?: boolean;
	versions?: ContentVersion[];
	activeVersion?: string;
	onVersionChange?: (version: string) => void;
	onCutVersion?: (input: { slug: string; label: string }) => void;
	/** Frozen snapshots are read-only: no create / reorder / delete. */
	frozen?: boolean;
}

type ViewTab = "all" | "trash";

const EXPAND_ALL_THRESHOLD = 80;
const ROW_INTRINSIC = "2.75rem";

const dropAnimation: DropAnimation = {
	sideEffects: defaultDropAnimationSideEffects({
		styles: { active: { opacity: "0.4" } },
	}),
};

function menuIcon(icon: React.ReactNode) {
	return (
		<span className="me-2 inline-flex h-4 w-4 flex-none items-center justify-center">{icon}</span>
	);
}

/**
 * Hierarchical content tree for collections with `supports: ["hierarchical"]`.
 *
 * Sibling order is the sidebar order. Both pages and sections can nest
 * children. Large trees stay collapsed by default; drag-and-drop (or the
 * row menu) reparents onto a page/section or reorders above/below.
 */
export function ContentTree({
	collection,
	collectionLabel,
	tree,
	isLoading,
	trashedItems = [],
	isTrashedLoading,
	trashedCount = 0,
	onDelete,
	onDuplicate,
	onRestore,
	onPermanentDelete,
	onReorder,
	onMove,
	i18n,
	activeLocale,
	onLocaleChange,
	urlPattern,
	versioned,
	versions = [],
	activeVersion,
	onVersionChange,
	onCutVersion,
	frozen,
}: ContentTreeProps) {
	const { t } = useLingui();
	const [activeTab, setActiveTab] = React.useState<ViewTab>("all");
	const [searchQuery, setSearchQuery] = React.useState("");
	const [cutOpen, setCutOpen] = React.useState(false);
	const [cutSlug, setCutSlug] = React.useState("");
	const [cutLabel, setCutLabel] = React.useState("");
	const [optimisticTree, setOptimisticTree] = React.useState<DocTreeNode[] | null>(null);

	React.useEffect(() => {
		setOptimisticTree(null);
	}, [tree]);

	const liveTree = optimisticTree ?? tree;
	const totalNodes = React.useMemo(() => countTreeNodes(liveTree), [liveTree]);

	const storageKey = `emdash:docs-tree:${collection}:${activeVersion ?? "current"}`;
	const [expanded, setExpanded] = React.useState<Set<string>>(() => {
		if (typeof sessionStorage === "undefined") return new Set();
		try {
			const raw = sessionStorage.getItem(storageKey);
			if (raw) return new Set(JSON.parse(raw) as string[]);
		} catch {
			/* ignore */
		}
		return new Set();
	});

	React.useEffect(() => {
		if (typeof sessionStorage === "undefined") return;
		try {
			sessionStorage.setItem(storageKey, JSON.stringify([...expanded]));
		} catch {
			/* ignore quota */
		}
	}, [expanded, storageKey]);

	React.useEffect(() => {
		if (totalNodes === 0) return;
		setExpanded((current) => {
			if (current.size > 0) return current;
			if (totalNodes <= EXPAND_ALL_THRESHOLD) return collectAllIds(tree);
			return new Set();
		});
	}, [totalNodes, tree]);

	const versionItems = React.useMemo(() => {
		const items: Record<string, string> = {};
		for (const version of versions) {
			items[version.slug] = version.isDefault ? `${version.label} (${t`default`})` : version.label;
		}
		if (Object.keys(items).length === 0) items.current = t`Current`;
		return items;
	}, [t, versions]);

	const newSearch = (extra: { nodeKind: "doc" | "section"; parentId?: string }) => ({
		locale: activeLocale,
		version: activeVersion,
		parentId: undefined,
		...extra,
	});

	const filteredTree = React.useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return liveTree;
		return filterTree(liveTree, query);
	}, [liveTree, searchQuery]);

	const searchOpenIds = React.useMemo(
		() => (searchQuery.trim() ? collectMatchAncestorIds(liveTree, searchQuery) : null),
		[liveTree, searchQuery],
	);

	const effectiveExpanded = React.useMemo(() => {
		if (!searchOpenIds) return expanded;
		const next = new Set(expanded);
		for (const id of searchOpenIds) next.add(id);
		return next;
	}, [expanded, searchOpenIds]);

	const canMove = !frozen && !searchQuery && !!(onMove || onReorder);

	const commitMove = React.useCallback(
		(move: TreeMove) => {
			setOptimisticTree((current) => applyTreeMove(current ?? liveTree, move));
			if (onMove) {
				onMove(move);
				return;
			}
			if (onReorder && move.fromParentId === move.toParentId) {
				onReorder(move.toParentId, move.toSiblingIds);
			}
		},
		[liveTree, onMove, onReorder],
	);

	const toggleExpanded = React.useCallback((id: string) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const expandAll = React.useCallback(() => {
		setExpanded(collectAllIds(liveTree));
	}, [liveTree]);

	const collapseAll = React.useCallback(() => {
		setExpanded(new Set());
	}, []);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-3 flex-wrap">
				<div className="flex items-center gap-4 min-w-0">
					<h1 className="text-2xl font-semibold leading-tight">{collectionLabel}</h1>
					{i18n && activeLocale && onLocaleChange && (
						<LocaleSwitcher
							locales={i18n.locales}
							defaultLocale={i18n.defaultLocale}
							value={activeLocale}
							onChange={onLocaleChange}
							size="sm"
						/>
					)}
					{versioned && onVersionChange && (
						<Select
							size="sm"
							aria-label={t`Docs version`}
							value={activeVersion ?? "current"}
							onValueChange={(value) => onVersionChange(value ?? "current")}
							items={versionItems}
						>
							{Object.entries(versionItems).map(([value, label]) => (
								<Select.Option key={value} value={value}>
									{label}
								</Select.Option>
							))}
						</Select>
					)}
					{totalNodes > 0 && (
						<span className="text-xs text-kumo-subtle tabular-nums">{t`${totalNodes} items`}</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					{versioned && onCutVersion && !frozen && (
						<Dialog.Root open={cutOpen} onOpenChange={setCutOpen}>
							<Dialog.Trigger
								render={(p) => (
									<Button {...p} variant="secondary">
										{t`Cut version`}
									</Button>
								)}
							/>
							<Dialog className="p-6" size="sm">
								<Dialog.Title className="text-lg font-semibold">{t`Cut version`}</Dialog.Title>
								<Dialog.Description className="text-kumo-subtle">
									{t`Snapshot the current docs tree into a frozen version. Further edits stay on Current.`}
								</Dialog.Description>
								<div className="mt-4 space-y-3">
									<label className="block space-y-1">
										<span className="text-sm font-medium">{t`Slug`}</span>
										<Input
											placeholder="1.0"
											value={cutSlug}
											onChange={(e) => setCutSlug(e.target.value)}
										/>
									</label>
									<label className="block space-y-1">
										<span className="text-sm font-medium">{t`Label`}</span>
										<Input
											placeholder="1.0"
											value={cutLabel}
											onChange={(e) => setCutLabel(e.target.value)}
										/>
									</label>
								</div>
								<div className="mt-6 flex justify-end gap-2">
									<Dialog.Close
										render={(p) => (
											<Button {...p} variant="secondary">
												{t`Cancel`}
											</Button>
										)}
									/>
									<Button
										disabled={!cutSlug.trim()}
										onClick={() => {
											onCutVersion({
												slug: cutSlug.trim(),
												label: cutLabel.trim() || cutSlug.trim(),
											});
											setCutSlug("");
											setCutLabel("");
											setCutOpen(false);
										}}
									>
										{t`Cut version`}
									</Button>
								</div>
							</Dialog>
						</Dialog.Root>
					)}
					{frozen && <Badge variant="secondary">{t`Frozen`}</Badge>}
					{!frozen && (
						<>
							<RouterLinkButton
								to="/content/$collection/new"
								params={{ collection }}
								search={newSearch({ nodeKind: "section" })}
								variant="secondary"
								icon={<FolderPlus />}
							>
								{t`Add section`}
							</RouterLinkButton>
							<RouterLinkButton
								to="/content/$collection/new"
								params={{ collection }}
								search={newSearch({ nodeKind: "doc" })}
								icon={<Plus />}
							>
								{t`Add page`}
							</RouterLinkButton>
						</>
					)}
				</div>
			</div>

			{(tree.length > 0 || searchQuery) && (
				<div className="flex items-center gap-2 flex-wrap">
					<div className="relative max-w-sm flex-1 min-w-[12rem]">
						<MagnifyingGlass className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kumo-subtle" />
						<Input
							type="search"
							placeholder={t`Search ${collectionLabel.toLowerCase()}...`}
							aria-label={t`Search ${collectionLabel.toLowerCase()}`}
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="ps-9"
						/>
					</div>
					{totalNodes > 12 && (
						<div className="flex items-center gap-1">
							<Button variant="ghost" size="sm" onClick={expandAll}>
								{t`Expand all`}
							</Button>
							<Button variant="ghost" size="sm" onClick={collapseAll}>
								{t`Collapse all`}
							</Button>
						</div>
					)}
				</div>
			)}

			<Tabs
				variant="underline"
				value={activeTab}
				onValueChange={(v) => {
					if (v === "all" || v === "trash") setActiveTab(v);
				}}
				tabs={[
					{ value: "all", label: t`All` },
					{
						value: "trash",
						label: (
							<span className="flex items-center gap-2">
								<Trash className="h-4 w-4" aria-hidden="true" />
								{t`Trash`}
								{trashedCount > 0 && <Badge variant="secondary">{trashedCount}</Badge>}
							</span>
						),
					},
				]}
			/>

			{activeTab === "all" ? (
				<div className="rounded-md border bg-kumo-base overflow-x-auto">
					{isLoading && tree.length === 0 ? (
						<div className="px-4 py-8 text-center text-kumo-subtle">
							<span className="inline-flex items-center gap-2">
								<Loader size="sm" />
								{t`Loading...`}
							</span>
						</div>
					) : tree.length === 0 ? (
						<div className="px-4 py-8 text-center text-kumo-subtle">
							{t`No ${collectionLabel.toLowerCase()} yet.`}{" "}
							<Link
								to="/content/$collection/new"
								params={{ collection }}
								search={newSearch({ nodeKind: "doc" })}
								className="text-kumo-link underline"
							>
								{t`Create your first one`}
							</Link>
						</div>
					) : filteredTree.length === 0 ? (
						<div className="px-4 py-8 text-center text-kumo-subtle">
							{t`No results for "${searchQuery}"`}
						</div>
					) : (
						<DocsTreeList
							tree={filteredTree}
							expanded={effectiveExpanded}
							onToggle={toggleExpanded}
							collection={collection}
							activeLocale={activeLocale}
							activeVersion={activeVersion}
							urlPattern={urlPattern}
							onDelete={frozen ? undefined : onDelete}
							onDuplicate={frozen ? undefined : onDuplicate}
							onCommitMove={canMove ? commitMove : undefined}
							frozen={frozen}
						/>
					)}
				</div>
			) : (
				<div className="rounded-md border bg-kumo-base overflow-x-auto">
					<table className="w-full">
						<thead>
							<tr className="border-b bg-kumo-tint/50">
								<th scope="col" className="px-4 py-3 text-start text-sm font-medium">
									{t`Title`}
								</th>
								<th scope="col" className="px-4 py-3 text-start text-sm font-medium">
									{t`Deleted`}
								</th>
								<th scope="col" className="px-4 py-3 text-end text-sm font-medium">
									{t`Actions`}
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-kumo-line">
							{isTrashedLoading && trashedItems.length === 0 ? (
								<tr>
									<td colSpan={3} className="px-4 py-8 text-center text-kumo-subtle">
										<span className="inline-flex items-center gap-2">
											<Loader size="sm" />
											{t`Loading...`}
										</span>
									</td>
								</tr>
							) : trashedItems.length === 0 ? (
								<tr>
									<td colSpan={3} className="px-4 py-8 text-center text-kumo-subtle">
										{t`Trash is empty`}
									</td>
								</tr>
							) : (
								trashedItems.map((item) => (
									<TrashedTreeItem
										key={item.id}
										item={item}
										onRestore={onRestore}
										onPermanentDelete={onPermanentDelete}
									/>
								))
							)}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function collectAllIds(nodes: DocTreeNode[]): Set<string> {
	const ids = new Set<string>();
	const walk = (list: DocTreeNode[]) => {
		for (const node of list) {
			if (node.children.length > 0) {
				ids.add(node.id);
				walk(node.children);
			}
		}
	};
	walk(nodes);
	return ids;
}

function DocsTreeList({
	tree,
	expanded,
	onToggle,
	collection,
	activeLocale,
	activeVersion,
	urlPattern,
	onDelete,
	onDuplicate,
	onCommitMove,
	frozen,
}: {
	tree: DocTreeNode[];
	expanded: ReadonlySet<string>;
	onToggle: (id: string) => void;
	collection: string;
	activeLocale?: string;
	activeVersion?: string;
	urlPattern?: string;
	onDelete?: (id: string) => void;
	onDuplicate?: (id: string) => void;
	onCommitMove?: (move: TreeMove) => void;
	frozen?: boolean;
}) {
	const { t, i18n } = useLingui();
	const [draggingId, setDraggingId] = React.useState<string | null>(null);
	const [overId, setOverId] = React.useState<string | null>(null);
	const [offsetX, setOffsetX] = React.useState(0);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	const flat = React.useMemo(
		() => flattenVisible(tree, expanded, { collapsedId: draggingId }),
		[tree, expanded, draggingId],
	);
	const ids = React.useMemo(() => flat.map((row) => row.id), [flat]);
	const dragging = flat.find((row) => row.id === draggingId) ?? null;
	const rtl = i18n.locale ? getLocaleDir(i18n.locale) === "rtl" : false;

	const projection: TreeProjection | null = React.useMemo(() => {
		if (!draggingId || !overId) return null;
		return getProjection(flat, draggingId, overId, rtl ? -offsetX : offsetX, TREE_INDENT_PX);
	}, [draggingId, overId, flat, offsetX, rtl]);

	const resetDrag = () => {
		setDraggingId(null);
		setOverId(null);
		setOffsetX(0);
	};

	const onDragStart = (event: DragStartEvent) => {
		setDraggingId(String(event.active.id));
		setOverId(String(event.active.id));
		setOffsetX(0);
	};

	const onDragMove = (event: DragMoveEvent) => {
		setOffsetX(event.delta.x);
	};

	const onDragOver = (event: DragOverEvent) => {
		setOverId(event.over ? String(event.over.id) : null);
	};

	const onDragEnd = (event: DragEndEvent) => {
		const activeId = String(event.active.id);
		const currentOver = event.over ? String(event.over.id) : overId;
		const nextProjection =
			currentOver && draggingId
				? getProjection(flat, activeId, currentOver, rtl ? -offsetX : offsetX, TREE_INDENT_PX)
				: projection;
		resetDrag();
		if (!currentOver || !onCommitMove || !nextProjection) return;
		const move = planMoveFromProjection(flat, activeId, nextProjection);
		if (!move) return;
		if (nextProjection.parentNodeId && !expanded.has(nextProjection.parentNodeId)) {
			onToggle(nextProjection.parentNodeId);
		}
		onCommitMove(move);
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragStart={onDragStart}
			onDragMove={onDragMove}
			onDragOver={onDragOver}
			onDragEnd={onDragEnd}
			onDragCancel={resetDrag}
		>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				<div role="tree" aria-label={t`Docs tree`} className="min-w-[28rem]">
					{flat.map((row) => (
						<TreeRow
							key={row.id}
							row={row}
							expanded={expanded.has(row.id)}
							onToggle={onToggle}
							collection={collection}
							activeLocale={activeLocale}
							activeVersion={activeVersion}
							urlPattern={urlPattern}
							onDelete={onDelete}
							onDuplicate={onDuplicate}
							onCommitMove={onCommitMove}
							flat={flat}
							projectedDepth={projection && draggingId === row.id ? projection.depth : undefined}
							nestTarget={projection?.parentNodeId === row.id}
							frozen={frozen}
						/>
					))}
				</div>
			</SortableContext>
			<DragOverlay dropAnimation={dropAnimation}>
				{dragging ? (
					<div
						className="flex items-center gap-2 rounded-md border bg-kumo-base px-3 py-2 text-sm shadow-lg ring-1 ring-kumo-line"
						style={{
							marginInlineStart: `${(projection?.depth ?? dragging.depth) * 1.1}rem`,
						}}
					>
						{dragging.node.kind === "section" ? (
							<Folder className="h-4 w-4 text-kumo-subtle" />
						) : (
							<FileText className="h-4 w-4 text-kumo-subtle" />
						)}
						<span className="font-medium">{dragging.node.title}</span>
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

function TreeRow({
	row,
	expanded,
	onToggle,
	collection,
	activeLocale,
	activeVersion,
	urlPattern,
	onDelete,
	onDuplicate,
	onCommitMove,
	flat,
	projectedDepth,
	nestTarget,
	frozen,
}: {
	row: FlatTreeNode;
	expanded: boolean;
	onToggle: (id: string) => void;
	collection: string;
	activeLocale?: string;
	activeVersion?: string;
	urlPattern?: string;
	onDelete?: (id: string) => void;
	onDuplicate?: (id: string) => void;
	onCommitMove?: (move: TreeMove) => void;
	flat: readonly FlatTreeNode[];
	projectedDepth?: number;
	nestTarget?: boolean;
	frozen?: boolean;
}) {
	const { t } = useLingui();
	const navigate = useNavigate();
	const { node } = row;
	const Icon = node.kind === "section" ? Folder : FileText;
	const statusState = isContentStatusState(node.status) ? node.status : undefined;
	const childCount = node.children.length;
	const canExpand = childCount > 0;
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: node.id,
		disabled: !onCommitMove || node.stranded,
	});

	const style: React.CSSProperties = {
		transform: CSS.Translate.toString(transform),
		transition,
		contentVisibility: "auto",
		containIntrinsicSize: ROW_INTRINSIC,
	};
	const displayDepth = projectedDepth ?? row.depth;

	const indent = planIndent(flat, node.id);
	const outdent = planOutdent(flat, node.id);
	const moveUp = planReorder(flat, node.id, -1);
	const moveDown = planReorder(flat, node.id, 1);

	const goNew = (kind: "doc" | "section") => {
		void navigate({
			to: "/content/$collection/new",
			params: { collection },
			search: {
				locale: activeLocale,
				version: activeVersion,
				parentId: node.translationGroup,
				nodeKind: kind,
			},
		});
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			role="treeitem"
			aria-expanded={canExpand ? expanded : undefined}
			aria-level={row.depth + 1}
			className={cn(
				"relative flex items-center gap-1 border-b border-kumo-line/60 px-2 py-1.5 hover:bg-kumo-tint/50",
				isDragging && "z-10 opacity-40 shadow-sm",
				nestTarget && "bg-kumo-tint ring-1 ring-inset ring-kumo-link/40",
			)}
		>
			<div
				style={{ marginInlineStart: `${displayDepth * 1.1}rem` }}
				className="flex min-w-0 flex-1 items-center gap-1"
			>
				{onCommitMove && !node.stranded ? (
					<button
						type="button"
						className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-kumo-subtle hover:bg-kumo-tint active:cursor-grabbing"
						aria-label={t`Drag ${node.title}`}
						{...attributes}
						{...listeners}
					>
						<DotsSixVertical className="h-4 w-4" aria-hidden="true" />
					</button>
				) : (
					<span className="inline-block h-7 w-7 shrink-0" />
				)}

				{canExpand ? (
					<button
						type="button"
						className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-kumo-subtle hover:bg-kumo-tint"
						aria-label={expanded ? t`Collapse ${node.title}` : t`Expand ${node.title}`}
						onClick={() => onToggle(node.id)}
					>
						{expanded ? (
							<CaretDown className="h-3.5 w-3.5" />
						) : (
							<CaretRight className="h-3.5 w-3.5" />
						)}
					</button>
				) : (
					<span className="inline-block h-7 w-7 shrink-0" />
				)}

				<Icon className="h-4 w-4 shrink-0 text-kumo-subtle" aria-hidden="true" />
				<Link
					to="/content/$collection/$id"
					params={{ collection, id: node.id }}
					search={{ locale: activeLocale }}
					className="min-w-0 truncate font-medium hover:text-kumo-link"
				>
					{node.title}
				</Link>
				{!expanded && childCount > 0 && (
					<Badge variant="secondary" className="shrink-0 tabular-nums text-[10px]">
						{childCount}
					</Badge>
				)}
				<span className="hidden truncate text-xs text-kumo-subtle lg:inline">/{node.path}</span>
				<Badge variant="secondary" className="shrink-0 text-[10px] uppercase">
					{node.kind === "section" ? t`Section` : t`Page`}
				</Badge>
				{statusState ? (
					<ContentStatusBadge state={statusState} />
				) : (
					<Badge variant="neutral">{node.status}</Badge>
				)}
				{node.stranded && (
					<Badge variant="secondary" className="shrink-0">
						{t`Orphaned`}
					</Badge>
				)}
			</div>

			<DropdownMenu>
				<DropdownMenu.Trigger
					render={(props) => (
						<Button
							{...props}
							variant="ghost"
							shape="square"
							aria-label={t`Actions for ${node.title}`}
						>
							<DotsThree className="h-4 w-4" weight="bold" />
						</Button>
					)}
				/>
				<DropdownMenu.Content align="end" className="min-w-52">
					{onCommitMove && (
						<>
							<DropdownMenu.Item
								disabled={!moveUp}
								icon={menuIcon(<CaretUp className="h-4 w-4" aria-hidden="true" />)}
								onClick={() => moveUp && onCommitMove(moveUp)}
							>
								{t`Move above`}
							</DropdownMenu.Item>
							<DropdownMenu.Item
								disabled={!moveDown}
								icon={menuIcon(<CaretDown className="h-4 w-4" aria-hidden="true" />)}
								onClick={() => moveDown && onCommitMove(moveDown)}
							>
								{t`Move below`}
							</DropdownMenu.Item>
							<DropdownMenu.Item
								disabled={!indent}
								icon={menuIcon(<ArrowLineRight className="h-4 w-4" aria-hidden="true" />)}
								onClick={() => indent && onCommitMove(indent)}
							>
								{t`Nest under previous`}
							</DropdownMenu.Item>
							<DropdownMenu.Item
								disabled={!outdent}
								icon={menuIcon(<ArrowLineLeft className="h-4 w-4" aria-hidden="true" />)}
								onClick={() => outdent && onCommitMove(outdent)}
							>
								{t`Move out`}
							</DropdownMenu.Item>
							<DropdownMenu.Separator />
						</>
					)}
					{!frozen && (
						<>
							<DropdownMenu.Item
								icon={menuIcon(<FilePlus className="h-4 w-4" aria-hidden="true" />)}
								onClick={() => goNew("doc")}
							>
								{t`Add page inside`}
							</DropdownMenu.Item>
							<DropdownMenu.Item
								icon={menuIcon(<FolderPlus className="h-4 w-4" aria-hidden="true" />)}
								onClick={() => goNew("section")}
							>
								{t`Add section inside`}
							</DropdownMenu.Item>
							<DropdownMenu.Separator />
						</>
					)}
					<DropdownMenu.Item
						icon={menuIcon(<Pencil className="h-4 w-4" aria-hidden="true" />)}
						onClick={() =>
							void navigate({
								to: "/content/$collection/$id",
								params: { collection, id: node.id },
								search: { locale: activeLocale },
							})
						}
					>
						{t`Edit`}
					</DropdownMenu.Item>
					{node.status === "published" && (
						<DropdownMenu.Item
							icon={menuIcon(<ArrowSquareOut className="h-4 w-4" aria-hidden="true" />)}
							onClick={() => {
								const href = contentUrl(collection, node.slug, urlPattern, node.path);
								if (href) window.open(href, "_blank", "noopener,noreferrer");
							}}
						>
							{t`View published`}
						</DropdownMenu.Item>
					)}
					<DropdownMenu.Item
						icon={menuIcon(<Copy className="h-4 w-4" aria-hidden="true" />)}
						onClick={() => onDuplicate?.(node.id)}
					>
						{t`Duplicate`}
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<TrashMenuItem node={node} onDelete={onDelete} />
				</DropdownMenu.Content>
			</DropdownMenu>
		</div>
	);
}

function TrashMenuItem({ node, onDelete }: { node: DocTreeNode; onDelete?: (id: string) => void }) {
	const { t } = useLingui();
	const [open, setOpen] = React.useState(false);
	return (
		<>
			<DropdownMenu.Item
				variant="danger"
				icon={menuIcon(<Trash className="h-4 w-4" aria-hidden="true" />)}
				onClick={() => setOpen(true)}
			>
				{t`Move to trash`}
			</DropdownMenu.Item>
			<Dialog.Root open={open} onOpenChange={setOpen} disablePointerDismissal>
				<Dialog className="p-6" size="sm">
					<Dialog.Title className="text-lg font-semibold">{t`Move to Trash?`}</Dialog.Title>
					<Dialog.Description className="text-kumo-subtle">
						{node.kind === "section"
							? t`Move "${node.title}" to trash? Sections with children cannot be deleted until those children are moved or removed.`
							: t`Move "${node.title}" to trash? You can restore it later.`}
					</Dialog.Description>
					<div className="mt-6 flex justify-end gap-2">
						<Dialog.Close
							render={(p) => (
								<Button {...p} variant="secondary">
									{t`Cancel`}
								</Button>
							)}
						/>
						<Dialog.Close
							render={(p) => (
								<Button {...p} variant="destructive" onClick={() => onDelete?.(node.id)}>
									{t`Move to Trash`}
								</Button>
							)}
						/>
					</div>
				</Dialog>
			</Dialog.Root>
		</>
	);
}

function TrashedTreeItem({
	item,
	onRestore,
	onPermanentDelete,
}: {
	item: TrashedContentItem;
	onRestore?: (id: string) => void;
	onPermanentDelete?: (id: string) => void;
}) {
	const { t } = useLingui();
	const rawTitle = item.data.title;
	const title = (typeof rawTitle === "string" ? rawTitle : "") || item.slug || item.id;
	const deletedDate = new Date(item.deletedAt);

	return (
		<tr className="hover:bg-kumo-tint/25">
			<td className="px-4 py-3">
				<span className="font-medium text-kumo-subtle">{title}</span>
			</td>
			<td className="px-4 py-3 text-sm text-kumo-subtle">{deletedDate.toLocaleDateString()}</td>
			<td className="px-4 py-3 text-end">
				<div className="flex items-center justify-end space-x-1">
					<Button
						variant="ghost"
						shape="square"
						aria-label={t`Restore ${title}`}
						onClick={() => onRestore?.(item.id)}
					>
						<ArrowCounterClockwise className="h-4 w-4 text-kumo-link" aria-hidden="true" />
					</Button>
					<Dialog.Root disablePointerDismissal>
						<Dialog.Trigger
							render={(p) => (
								<Button
									{...p}
									variant="ghost"
									shape="square"
									aria-label={t`Permanently delete ${title}`}
								>
									<Trash className="h-4 w-4 text-kumo-danger" aria-hidden="true" />
								</Button>
							)}
						/>
						<Dialog className="p-6" size="sm">
							<Dialog.Title className="text-lg font-semibold">{t`Delete Permanently?`}</Dialog.Title>
							<Dialog.Description className="text-kumo-subtle">
								{t`Permanently delete "${title}"? This cannot be undone.`}
							</Dialog.Description>
							<div className="mt-6 flex justify-end gap-2">
								<Dialog.Close
									render={(p) => (
										<Button {...p} variant="secondary">
											{t`Cancel`}
										</Button>
									)}
								/>
								<Dialog.Close
									render={(p) => (
										<Button
											{...p}
											variant="destructive"
											onClick={() => onPermanentDelete?.(item.id)}
										>
											{t`Delete Permanently`}
										</Button>
									)}
								/>
							</div>
						</Dialog>
					</Dialog.Root>
				</div>
			</td>
		</tr>
	);
}
