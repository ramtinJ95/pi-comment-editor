import { highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	Editor,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type EditorTheme,
	type Focusable,
	type TUI,
} from "@earendil-works/pi-tui";
import {
	annotationsAtLine,
	buildWrappedSourceRows,
	createReviewState,
	ensureCursorVisible,
	getActiveAnnotation,
	getCurrentTarget,
	highlightFencedCodeLines,
	pageTarget,
	reduceReviewState,
	type AnnotationKind,
	type ResponseAnnotation,
	type ResponseDocument,
	type ReviewAction,
	type ReviewState,
	type WrappedSourceRow,
} from "./response-review.ts";

export type ResponseReviewResult =
	| { kind: "completed"; annotations: readonly ResponseAnnotation[] }
	| { kind: "empty" }
	| { kind: "cancelled" };

interface LayoutSnapshot {
	rows: WrappedSourceRow[];
	bodyHeight: number;
}

function editorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (text) => theme.fg("accent", text),
		selectList: {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		},
	};
}

function kindLabel(kind: AnnotationKind): string {
	return kind === "comment" ? "COMMENT" : kind === "suggestion" ? "SUGGESTION" : "ISSUE";
}

function kindColor(kind: AnnotationKind): "accent" | "success" | "error" {
	return kind === "comment" ? "accent" : kind === "suggestion" ? "success" : "error";
}

function markerForAnnotations(annotations: readonly ResponseAnnotation[]): string {
	if (annotations.some((annotation) => annotation.kind === "issue")) return "!";
	if (annotations.some((annotation) => annotation.kind === "suggestion")) return "+";
	return annotations.length > 0 ? "•" : " ";
}

function fitLine(text: string, width: number): string {
	return visibleWidth(text) <= width ? text : truncateToWidth(text, Math.max(1, width), "…");
}

function boundedEditorRows(editor: Editor, width: number, height: number): string[] {
	const rows = editor.render(Math.max(1, width));
	if (rows.length <= height) return rows;
	const cursorRow = Math.max(0, rows.findIndex((row) => row.includes(CURSOR_MARKER)));
	const offset = Math.max(0, Math.min(cursorRow - height + 1, rows.length - height));
	return rows.slice(offset, offset + height);
}

export class ResponseReviewComponent implements Component, Focusable {
	private state: ReviewState;
	private readonly editor: Editor;
	private viewportOffset = 0;
	private lastLayout?: LayoutSnapshot;
	private highlightedDisplayLines?: readonly string[];
	private completed = false;
	private _focused = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		document: ResponseDocument,
		private readonly done: (result: ResponseReviewResult) => void,
	) {
		this.state = createReviewState(document);
		this.editor = new Editor(tui, editorTheme(theme), { paddingX: 0 });
		this.editor.disableSubmit = true;
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.editor.focused = value && this.state.mode.kind === "draft";
	}

	invalidate(): void {
		this.lastLayout = undefined;
		this.highlightedDisplayLines = undefined;
		this.editor.invalidate();
	}

	private refresh(): void {
		this.lastLayout = undefined;
		this.editor.invalidate();
		this.tui.requestRender();
	}

	private getHighlightedDisplayLines(): readonly string[] {
		if (!this.highlightedDisplayLines) {
			this.highlightedDisplayLines = highlightFencedCodeLines(
				this.state.document,
				(code, language) => {
					try {
						return highlightCode(code, language);
					} catch {
						return code.split("\n").map((line) => this.theme.fg("mdCodeBlock", line));
					}
				},
				(line) => this.theme.fg("mdCodeBlockBorder", line),
			);
		}
		return this.highlightedDisplayLines;
	}

	private finish(result: ResponseReviewResult): void {
		if (this.completed) return;
		this.completed = true;
		this.done(result);
	}

	private dispatch(action: ReviewAction): void {
		this.state = reduceReviewState(this.state, action);
		this.editor.focused = this._focused && this.state.mode.kind === "draft";
		if (this.state.mode.kind === "cancelled") {
			this.finish({ kind: "cancelled" });
			return;
		}
		if (this.state.mode.kind === "completed") {
			this.finish(
				this.state.annotations.length > 0
					? { kind: "completed", annotations: this.state.annotations }
					: { kind: "empty" },
			);
			return;
		}
		this.refresh();
	}

	private beginDraft(kind: AnnotationKind, overall = false): void {
		this.dispatch({
			type: "beginDraft",
			kind,
			target: overall ? { kind: "overall" } : getCurrentTarget(this.state),
		});
		if (this.state.mode.kind === "draft") this.editor.setText(this.state.mode.draft.initialBody);
		this.refresh();
	}

	private editActiveAnnotation(): void {
		const annotation = getActiveAnnotation(this.state);
		if (!annotation) return;
		this.dispatch({ type: "edit", id: annotation.id });
		if (this.state.mode.kind === "draft") this.editor.setText(this.state.mode.draft.initialBody);
		this.refresh();
	}

	private page(delta: number): void {
		if (!this.lastLayout) {
			this.dispatch({ type: "move", delta: Math.sign(delta) * 10 });
			return;
		}
		const target = pageTarget(
			this.lastLayout.rows,
			this.state.cursorLine,
			this.viewportOffset,
			delta,
			this.lastLayout.bodyHeight,
		);
		this.viewportOffset = target.viewportOffset;
		this.dispatch({ type: "moveTo", line: target.line });
	}

	handleInput(data: string): void {
		if (this.completed) return;

		if (this.state.mode.kind === "draft") {
			if (matchesKey(data, Key.escape)) {
				this.editor.setText("");
				this.dispatch({ type: "cancelDraft" });
				return;
			}
			if (matchesKey(data, Key.ctrl("s"))) {
				this.dispatch({ type: "saveDraft", body: this.editor.getExpandedText() });
				if (this.state.mode.kind !== "draft") this.editor.setText("");
				return;
			}
			if (matchesKey(data, Key.enter)) {
				this.editor.insertTextAtCursor("\n");
				this.refresh();
				return;
			}
			this.editor.handleInput(data);
			this.refresh();
			return;
		}

		if (this.state.mode.kind === "confirmDiscard") {
			if (matchesKey(data, "y") || matchesKey(data, Key.enter)) {
				this.dispatch({ type: "confirmDiscard" });
			} else if (matchesKey(data, "n") || matchesKey(data, Key.escape)) {
				this.dispatch({ type: "cancelDiscard" });
			}
			return;
		}

		if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
			this.dispatch({ type: "move", delta: -1 });
		} else if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
			this.dispatch({ type: "move", delta: 1 });
		} else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("u"))) {
			this.page(-1);
		} else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("d"))) {
			this.page(1);
		} else if (matchesKey(data, Key.shift("g"))) {
			this.dispatch({ type: "moveTo", line: this.state.document.lines.length - 1 });
		} else if (matchesKey(data, "g")) {
			this.dispatch({ type: "moveTo", line: 0 });
		} else if (matchesKey(data, "v")) {
			this.dispatch({ type: "toggleSelection" });
		} else if (matchesKey(data, Key.shift("c"))) {
			this.beginDraft("comment", true);
		} else if (matchesKey(data, "c")) {
			this.beginDraft("comment");
		} else if (matchesKey(data, "s")) {
			this.beginDraft("suggestion");
		} else if (matchesKey(data, "i")) {
			this.beginDraft("issue");
		} else if (matchesKey(data, Key.leftbracket)) {
			this.dispatch({ type: "navigateAnnotation", delta: -1 });
		} else if (matchesKey(data, Key.rightbracket)) {
			this.dispatch({ type: "navigateAnnotation", delta: 1 });
		} else if (matchesKey(data, "e")) {
			this.editActiveAnnotation();
		} else if (matchesKey(data, "d")) {
			const annotation = getActiveAnnotation(this.state);
			if (annotation) this.dispatch({ type: "delete", id: annotation.id });
		} else if (matchesKey(data, "y")) {
			this.dispatch({ type: "finish" });
		} else if (matchesKey(data, Key.escape)) {
			this.dispatch({ type: "requestCancel" });
		}
	}

	private renderSourceRow(row: WrappedSourceRow, width: number, digits: number): string {
		const current = row.sourceLine === this.state.cursorLine;
		const annotations = annotationsAtLine(this.state.annotations, row.sourceLine);
		const marker = markerForAnnotations(annotations);
		const number = row.continuation ? " ".repeat(digits) : String(row.sourceLine + 1).padStart(digits);
		const cursor = current && !row.continuation ? "›" : " ";
		let prefix = `${cursor}${marker} ${number} │ `;
		prefix = current ? this.theme.fg("accent", prefix) : this.theme.fg("dim", prefix);

		let body = this.theme.fg("text", row.text);
		if (this.state.mode.kind === "select") {
			const target = getCurrentTarget(this.state);
			if (
				target.kind === "lines" &&
				row.sourceLine >= target.startLine &&
				row.sourceLine <= target.endLine
			) {
				body = this.theme.bg("selectedBg", body);
			}
		}
		return fitLine(prefix + body, width);
	}

	private previewLines(width: number, maxRows: number): string[] {
		const annotation = getActiveAnnotation(this.state);
		if (!annotation || maxRows < 2) return [];
		const target =
			annotation.target.kind === "overall"
				? "overall response"
				: annotation.target.startLine === annotation.target.endLine
					? `line ${annotation.target.startLine + 1}`
					: `lines ${annotation.target.startLine + 1}-${annotation.target.endLine + 1}`;
		const heading = this.theme.fg(
			kindColor(annotation.kind),
			`${kindLabel(annotation.kind)} · ${target}`,
		);
		const body = wrapTextWithAnsi(annotation.body, Math.max(1, width - 2)).slice(0, maxRows - 1);
		return [fitLine(` ${heading}`, width), ...body.map((line) => fitLine(` ${line}`, width))];
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, Math.trunc(width));
		const terminalHeight = Math.max(1, this.tui.terminal.rows);
		const draftErrorRows =
			this.state.mode.kind === "draft" && this.state.mode.draft.error ? 1 : 0;
		const minimumHeight = this.state.mode.kind === "draft" ? 10 + draftErrorRows : 7;
		if (renderWidth < 18 || terminalHeight < minimumHeight) {
			const fallbackLines =
				this.state.mode.kind === "confirmDiscard"
					? [
							fitLine(this.theme.fg("accent", "Response review"), renderWidth),
							fitLine(this.theme.fg("warning", "Discard saved annotations?"), renderWidth),
							fitLine(this.theme.fg("dim", "y/Enter discard · n/Esc keep"), renderWidth),
						]
					: [
							fitLine(this.theme.fg("accent", "Response review"), renderWidth),
							fitLine(this.theme.fg("warning", "Terminal too small"), renderWidth),
							fitLine(this.theme.fg("dim", "Resize or Esc to cancel"), renderWidth),
						];
			return fallbackLines.slice(0, terminalHeight);
		}

		const lines: string[] = [];
		const border = this.theme.fg("borderAccent", "─".repeat(renderWidth));
		lines.push(border);
		lines.push(
			fitLine(
				` ${this.theme.bold(this.theme.fg("accent", "Response review"))} ${this.theme.fg(
					"dim",
					`· line ${this.state.cursorLine + 1}/${this.state.document.lines.length} · ${this.state.annotations.length} annotation${this.state.annotations.length === 1 ? "" : "s"}`,
				)}`,
				renderWidth,
			),
		);

		if (this.state.mode.kind === "confirmDiscard") {
			lines.push(fitLine(this.theme.fg("warning", " Discard all saved annotations? y/Enter yes · n/Esc no"), renderWidth));
		} else if (this.state.mode.kind === "select") {
			const target = getCurrentTarget(this.state);
			const label = target.kind === "lines" ? `${target.startLine + 1}-${target.endLine + 1}` : "";
			lines.push(fitLine(this.theme.fg("accent", ` Selecting response lines ${label}`), renderWidth));
		} else if (this.state.mode.kind === "draft") {
			const draft = this.state.mode.draft;
			const target =
				draft.target.kind === "overall"
					? "overall response"
					: draft.target.startLine === draft.target.endLine
						? `line ${draft.target.startLine + 1}`
						: `lines ${draft.target.startLine + 1}-${draft.target.endLine + 1}`;
			lines.push(
				fitLine(
					this.theme.fg(
						kindColor(draft.kind),
						` ${draft.editingId ? "Editing" : "New"} ${kindLabel(draft.kind).toLowerCase()} · ${target}`,
					),
					renderWidth,
				),
			);
		} else {
			lines.push(fitLine(this.theme.fg("dim", " Raw Markdown source · logical line ranges"), renderWidth));
		}

		const digits = String(this.state.document.lines.length).length;
		const gutterWidth = digits + 6;
		const bodyWidth = Math.max(1, renderWidth - gutterWidth);
		const fixedRows = 5 + draftErrorRows;
		const draftRows = this.state.mode.kind === "draft" ? Math.min(6, Math.max(3, Math.floor(terminalHeight / 3))) : 0;
		const previewRows = this.state.mode.kind === "browse" ? Math.min(4, Math.max(0, terminalHeight - 10)) : 0;
		// Pi's footer and widgets share the screen, so size the source like Pi's session tree selector.
		const bodyHeight = Math.min(
			Math.max(5, Math.floor(terminalHeight / 2)),
			terminalHeight - fixedRows - draftRows - previewRows,
		);
		const rows = buildWrappedSourceRows(
			this.state.document,
			bodyWidth,
			this.getHighlightedDisplayLines(),
		);
		this.viewportOffset = ensureCursorVisible(
			rows,
			this.state.cursorLine,
			this.viewportOffset,
			bodyHeight,
		);
		this.lastLayout = { rows, bodyHeight };

		for (const row of rows.slice(this.viewportOffset, this.viewportOffset + bodyHeight)) {
			lines.push(this.renderSourceRow(row, renderWidth, digits));
		}

		if (this.state.mode.kind === "draft") {
			const draft = this.state.mode.draft;
			if (draft.error) lines.push(fitLine(this.theme.fg("error", ` ${draft.error}`), renderWidth));
			lines.push(...boundedEditorRows(this.editor, Math.max(1, renderWidth - 2), draftRows).map((line) => fitLine(` ${line}`, renderWidth)));
			lines.push(fitLine(this.theme.fg("dim", " Ctrl-s save · Esc cancel draft · Enter newline"), renderWidth));
		} else {
			lines.push(...this.previewLines(renderWidth, previewRows));
			lines.push(
				fitLine(
					this.theme.fg(
						"dim",
						" j/k move · v select · c/s/i annotate · C overall · [/] review · e edit · d delete · y finish · Esc cancel",
					),
					renderWidth,
				),
			);
		}
		lines.push(border);

		return lines.map((line) => fitLine(line, renderWidth));
	}
}
