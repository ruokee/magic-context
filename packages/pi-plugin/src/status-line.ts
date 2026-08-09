import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ContextDatabase } from "@magic-context/core/features/magic-context/storage";

const STATUS_KEY = "magic-context";
const RECENT_FAILURE_MS = 60_000;
const STATUS_VISIBLE_MS = 4_000;
const recompSessions = new Set<string>();

export interface StatusLineDeps {
	db: ContextDatabase;
	projectIdentity: string;
}

export function setMagicContextRecompActive(
	sessionId: string,
	active: boolean,
): void {
	if (active) recompSessions.add(sessionId);
	else recompSessions.delete(sessionId);
}

type SessionMetaStatus = {
	compartment_in_progress: number | null;
	historian_failure_count: number | null;
	historian_last_failure_at: number | null;
};

const lastRenderedBySession = new Map<string, string>();
const statusClearTimers = new Map<string, NodeJS.Timeout>();

/** Brief Magic Context state-change notice for OMP's hook-status area. */
export function registerStatusLine(
	pi: ExtensionAPI,
	deps: StatusLineDeps,
): void {
	void deps.projectIdentity;

	pi.on("session_start", async (_event, ctx) =>
		updateStatusLine(ctx, deps, true),
	);
	pi.on("agent_end", async (_event, ctx) => updateStatusLine(ctx, deps));
	pi.on("session_compact", async (_event, ctx) =>
		updateStatusLine(ctx, deps, true),
	);
	pi.on("tool_execution_end", async (_event, ctx) =>
		updateStatusLine(ctx, deps),
	);
	pi.on("message_end", async (event, ctx) => {
		const role = (event.message as { role?: unknown } | undefined)?.role;
		if (role === "assistant") updateStatusLine(ctx, deps);
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionId = resolveSessionId(ctx);
		if (sessionId) {
			lastRenderedBySession.delete(sessionId);
			clearTimeout(statusClearTimers.get(sessionId));
			statusClearTimers.delete(sessionId);
		}
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}

export function updateStatusLine(
	ctx: ExtensionContext,
	deps: StatusLineDeps,
	force = false,
): void {
	const sessionId = resolveSessionId(ctx);
	if (!sessionId) return;
	const text = renderStatusText(deps.db, sessionId);
	if (!force && lastRenderedBySession.get(sessionId) === text) return;
	lastRenderedBySession.set(sessionId, text);

	clearTimeout(statusClearTimers.get(sessionId));
	ctx.ui.setStatus(STATUS_KEY, text);
	statusClearTimers.set(
		sessionId,
		setTimeout(() => {
			statusClearTimers.delete(sessionId);
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}, STATUS_VISIBLE_MS),
	);
}

function renderStatusText(db: ContextDatabase, sessionId: string): string {
	const meta = readSessionMetaStatus(db, sessionId);
	return `MC:${renderHistorianState(meta, recompSessions.has(sessionId))}`;
}

function renderHistorianState(
	meta: SessionMetaStatus | undefined,
	recompActive: boolean,
): string {
	const failureCount = meta?.historian_failure_count ?? 0;
	const lastFailureAt = meta?.historian_last_failure_at ?? 0;
	if (failureCount > 0 && lastFailureAt > 0) {
		const ageMs = Date.now() - lastFailureAt;
		if (ageMs >= 0 && ageMs < RECENT_FAILURE_MS) return "historian-failed";
	}
	if (recompActive) return "recomp";
	if ((meta?.compartment_in_progress ?? 0) !== 0) return "historian";
	return "idle";
}

function readSessionMetaStatus(
	db: ContextDatabase,
	sessionId: string,
): SessionMetaStatus | undefined {
	try {
		return db
			.prepare<[string], SessionMetaStatus>(
				"SELECT compartment_in_progress, historian_failure_count, historian_last_failure_at FROM session_meta WHERE session_id = ?",
			)
			.get(sessionId);
	} catch {
		return undefined;
	}
}

function resolveSessionId(ctx: ExtensionContext): string | undefined {
	const getSessionId = (
		ctx.sessionManager as { getSessionId?: () => string | undefined }
	).getSessionId;
	if (typeof getSessionId !== "function") return undefined;
	try {
		const id = getSessionId.call(ctx.sessionManager);
		return typeof id === "string" && id.length > 0 ? id : undefined;
	} catch {
		return undefined;
	}
}
