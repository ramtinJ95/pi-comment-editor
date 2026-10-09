import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import {
	ResponseReviewComponent,
	type ResponseReviewResult,
} from "../extensions/comment-editor/response-review-component.ts";
import { createResponseDocument } from "../extensions/comment-editor/response-review.ts";

function harness(source = "zero\none\ntwo", rows = 20) {
	const renderRequests = { count: 0 };
	const tui = {
		terminal: { rows, columns: 80 },
		requestRender() {
			renderRequests.count++;
		},
	} as unknown as TUI;
	const theme = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	} as unknown as Theme;
	const results: ResponseReviewResult[] = [];
	const component = new ResponseReviewComponent(
		tui,
		theme,
		createResponseDocument(source),
		(result) => results.push(result),
	);
	component.focused = true;
	return { component, results, renderRequests };
}

function enterText(component: ResponseReviewComponent, text: string): void {
	for (const character of text) component.handleInput(character);
}

describe("ResponseReviewComponent", () => {
	test("renders width-safe output for normal and tiny terminals", () => {
		const { component } = harness("界界界\nlong unbroken https://example.test/abcdefghijk", 12);
		for (const width of [1, 10, 18, 24, 50]) {
			for (const line of component.render(width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("keeps draft layouts within the terminal height budget", () => {
		for (const rows of [7, 8, 9, 10, 11]) {
			const { component } = harness("zero\none\ntwo", rows);
			component.handleInput("c");
			const draftOutput = component.render(60);
			expect(draftOutput.length).toBeLessThanOrEqual(rows);
			expect(draftOutput.join("\n").includes("Terminal too small")).toBe(rows < 10);

			component.handleInput("\x13");
			const errorOutput = component.render(60);
			expect(errorOutput.length).toBeLessThanOrEqual(rows);
			expect(errorOutput.join("\n").includes("Terminal too small")).toBe(rows < 11);
		}
	});

	test("leaves room for Pi's chrome when a long response fills the screen", () => {
		const rows = 40;
		const source = Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n");
		const { component } = harness(source, rows);
		const sourceRows = (output: string[]) => output.filter((line) => line.includes(" │ ")).length;

		component.handleInput("c");
		enterText(component, "first");
		component.handleInput("\r");
		enterText(component, "second");
		component.handleInput("\r");
		enterText(component, "third");
		const draftOutput = component.render(80);
		expect(sourceRows(draftOutput)).toBe(rows / 2);
		expect(draftOutput.length).toBeLessThan(rows);
		expect(draftOutput.at(-2)).toContain("Ctrl-s save");

		component.handleInput("\x13");
		const browseOutput = component.render(80);
		expect(sourceRows(browseOutput)).toBe(rows / 2);
		expect(browseOutput.length).toBeLessThan(rows);
		expect(browseOutput[0]).toMatch(/^─+$/);
		expect(browseOutput[1]).toContain("Response review");
		expect(browseOutput.join("\n")).toContain("third");
		expect(browseOutput.at(-2)).toContain("j/k move");
		expect(browseOutput.at(-1)).toMatch(/^─+$/);
	});

	test("preserves syntax highlighting across state-only refreshes", () => {
		const { component } = harness("```ts\nconst value = 1;\n```\nafter");
		component.render(60);
		const internals = component as unknown as {
			highlightedDisplayLines?: readonly string[];
		};
		const highlighted = internals.highlightedDisplayLines;

		component.handleInput("j");
		component.render(60);
		expect(internals.highlightedDisplayLines).toBe(highlighted);

		component.handleInput("c");
		component.handleInput("x");
		component.render(60);
		expect(internals.highlightedDisplayLines).toBe(highlighted);

		component.invalidate();
		expect(internals.highlightedDisplayLines).toBeUndefined();
	});

	test("creates a typed backward range annotation and completes once", () => {
		const { component, results } = harness();
		component.render(60);
		component.handleInput("j");
		component.handleInput("j");
		component.handleInput("v");
		component.handleInput("k");
		component.handleInput("i");
		enterText(component, "Incorrect claim");
		component.handleInput("\x13");
		component.handleInput("y");
		component.handleInput("y");

		expect(results).toEqual([
			{
				kind: "completed",
				annotations: [
					{
						id: "annotation-1",
						ordinal: 1,
						target: { kind: "lines", startLine: 1, endLine: 2 },
						kind: "issue",
						body: "Incorrect claim",
					},
				],
			},
		]);
	});

	test("supports overall comments and draft validation", () => {
		const { component, results } = harness();
		component.handleInput("C");
		component.handleInput("\x13");
		expect(component.render(60).join("\n")).toContain("Annotation text cannot be blank");

		enterText(component, "Shorten it");
		component.handleInput("\r");
		enterText(component, "Keep the key detail");
		component.handleInput("\x13");
		component.handleInput("y");

		expect(results[0]).toMatchObject({
			kind: "completed",
			annotations: [
				{
					target: { kind: "overall" },
					kind: "comment",
					body: "Shorten it\nKeep the key detail",
				},
			],
		});
	});

	test("navigates, edits, and deletes saved annotations", () => {
		const { component, results } = harness();
		component.handleInput("c");
		enterText(component, "first");
		component.handleInput("\x13");
		component.handleInput("j");
		component.handleInput("i");
		enterText(component, "second");
		component.handleInput("\x13");

		component.handleInput("[");
		component.handleInput("e");
		enterText(component, " updated");
		component.handleInput("\x13");
		component.handleInput("]");
		component.handleInput("d");
		component.handleInput("y");

		expect(results).toMatchObject([
			{
				kind: "completed",
				annotations: [{ target: { kind: "lines", startLine: 0, endLine: 0 }, body: "first updated" }],
			},
		]);
	});

	test("cancels immediately when empty and confirms discard when saved", () => {
		const empty = harness();
		empty.component.handleInput("\x1b");
		expect(empty.results).toEqual([{ kind: "cancelled" }]);

		const saved = harness();
		saved.component.handleInput("c");
		enterText(saved.component, "keep me");
		saved.component.handleInput("\x13");
		saved.component.handleInput("\x1b");
		expect(saved.results).toEqual([]);
		expect(saved.component.render(60).join("\n")).toContain("Discard all saved annotations?");
		saved.component.handleInput("n");
		expect(saved.results).toEqual([]);
		saved.component.handleInput("\x1b");
		saved.component.handleInput("y");
		expect(saved.results).toEqual([{ kind: "cancelled" }]);
	});

	test("shows actionable discard confirmation in the small-terminal fallback", () => {
		const { component, results } = harness("zero\none", 6);
		component.handleInput("c");
		enterText(component, "saved note");
		component.handleInput("\x13");
		component.handleInput("\x1b");

		const output = component.render(60).join("\n");
		expect(output).toContain("Discard saved annotations?");
		expect(output).toContain("y/Enter discard · n/Esc keep");

		component.handleInput("y");
		expect(results).toEqual([{ kind: "cancelled" }]);
	});

	test("finishing without annotations returns an explicit empty result", () => {
		const { component, results } = harness();
		component.handleInput("y");
		expect(results).toEqual([{ kind: "empty" }]);
	});
});
