import { describe, expect, it, mock } from "bun:test";
import { updateStatusLine } from "./status-line";

describe("OMP status line", () => {
	it("keeps the Magic Context hook status hidden", () => {
		const setStatus = mock(() => {});

		updateStatusLine({ ui: { setStatus } } as never, {} as never);

		expect(setStatus).toHaveBeenCalledWith("magic-context", undefined);
	});
});
