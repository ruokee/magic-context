import { describe, expect, it, mock, spyOn } from "bun:test";
import { setMagicContextRecompActive, updateStatusLine } from "./status-line";

type SessionMetaStatus = {
	compartment_in_progress: number | null;
	historian_failure_count: number | null;
	historian_last_failure_at: number | null;
};

function createHarness(initialMeta: SessionMetaStatus) {
	let meta = initialMeta;
	const setStatus = mock(() => {});
	const ctx = {
		ui: { setStatus },
		sessionManager: { getSessionId: () => "session" },
	} as never;
	const db = {
		prepare: () => ({ get: () => meta }),
	} as never;

	return {
		ctx,
		deps: { db, projectIdentity: "project" },
		setMeta: (next: SessionMetaStatus) => {
			meta = next;
		},
		setStatus,
	};
}

const idleMeta: SessionMetaStatus = {
	compartment_in_progress: 0,
	historian_failure_count: 0,
	historian_last_failure_at: 0,
};

describe("OMP status notice", () => {
	it("shows concise state changes for four seconds", () => {
		const callbacks: Array<() => void> = [];
		const handles = Array.from(
			{ length: 4 },
			(_, index) => ({ index }) as unknown as NodeJS.Timeout,
		);
		const setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(((
			callback: () => void,
			delay?: number,
		) => {
			expect(delay).toBe(4_000);
			callbacks.push(callback);
			return handles[callbacks.length - 1];
		}) as typeof setTimeout);
		const clearTimeoutSpy = spyOn(
			globalThis,
			"clearTimeout",
		).mockImplementation(() => {});
		const harness = createHarness(idleMeta);

		try {
			updateStatusLine(harness.ctx, harness.deps, true);
			expect(harness.setStatus).toHaveBeenLastCalledWith(
				"magic-context",
				"MC:idle",
			);

			harness.setMeta({ ...idleMeta, compartment_in_progress: 1 });
			updateStatusLine(harness.ctx, harness.deps, true);
			expect(harness.setStatus).toHaveBeenLastCalledWith(
				"magic-context",
				"MC:historian",
			);
			expect(clearTimeoutSpy).toHaveBeenLastCalledWith(handles[0]);

			setMagicContextRecompActive("session", true);
			harness.setMeta(idleMeta);
			updateStatusLine(harness.ctx, harness.deps, true);
			expect(harness.setStatus).toHaveBeenLastCalledWith(
				"magic-context",
				"MC:recomp",
			);

			harness.setMeta({
				...idleMeta,
				historian_failure_count: 1,
				historian_last_failure_at: Date.now(),
			});
			updateStatusLine(harness.ctx, harness.deps, true);
			expect(harness.setStatus).toHaveBeenLastCalledWith(
				"magic-context",
				"MC:historian-failed",
			);

			callbacks[3]();
			expect(harness.setStatus).toHaveBeenLastCalledWith(
				"magic-context",
				undefined,
			);
		} finally {
			setMagicContextRecompActive("session", false);
			setTimeoutSpy.mockRestore();
			clearTimeoutSpy.mockRestore();
		}
	});
});
