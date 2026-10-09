# pi-comment-editor

Native, line-based review for [Pi](https://github.com/earendil-works/pi-mono) assistant responses.

`@ramtinj95/pi-comment-editor` opens the latest completed assistant response in a Pi-native review interface. Navigate the original Markdown by logical source line, attach typed feedback to exact lines or ranges, and prepare a structured follow-up in Pi's input editor.

Nothing is submitted automatically.

## Demo

The demo covers wrapped-line navigation, Markdown and fenced-code highlighting, range annotations, annotation management, and the final editable prompt.

https://github.com/user-attachments/assets/a6b11273-d364-4b70-8899-a51387d7b1f3

## Install

```bash
pi install npm:@ramtinj95/pi-comment-editor
```

Run `/reload` or restart Pi after installation. Pi packages execute with full system access, so review extensions before installing them.

## Quick start

After Pi completes a response, run:

```text
/comment
```

Then:

1. Move to the response line you want to review.
2. Press `c`, `s`, or `i` to add a comment, suggestion, or issue.
3. Press `v`, move to another line, and annotate to target a range.
4. Press `Ctrl-s` to save each annotation draft.
5. Press `y` to finish.
6. Review or edit the prepared message in Pi's input editor before sending it yourself.

## Native review interface

The reviewer uses Pi's theme and keeps the assistant response tied to its original source:

- Raw Markdown remains visible with stable, 1-based logical line numbers.
- Fenced code uses Pi's syntax highlighting, including language-tagged TypeScript and JSON.
- Long lines wrap to the terminal width without becoming new source lines.
- Page navigation moves through wrapped display rows while preserving the logical cursor line.
- Selected ranges use Pi's selection color.
- The gutter shows `!` for issues, `+` for suggestions, and `•` for comments.
- The active annotation and its target are previewed below the response.
- Tabs are expanded for display, and terminal control characters are rendered visibly, without changing the exact source quoted in the prepared review.

Selections work in either direction. Start at one endpoint with `v`, move up or down, then choose an annotation type.

### Annotation types

| Type | Key | Intended use |
| --- | --- | --- |
| Comment | `c` | Context, questions, or general feedback on a line or range |
| Suggestion | `s` | A concrete improvement to a line or range |
| Issue | `i` | Incorrect, unsafe, contradictory, or broken content |
| Overall comment | `C` | Feedback about the response as a whole |

Annotations may overlap. Overall comments appear first in the prepared review; line annotations are ordered by source position and then creation order.

## Keybindings

### Navigate and select

| Key | Action |
| --- | --- |
| `j` / `Down` | Move to the next logical source line |
| `k` / `Up` | Move to the previous logical source line |
| `Ctrl-d` / `PageDown` | Move down one viewport page |
| `Ctrl-u` / `PageUp` | Move up one viewport page |
| `g` | Jump to the first source line |
| `G` | Jump to the last source line |
| `v` | Start or cancel a line-range selection |

### Annotate and manage

| Key | Action |
| --- | --- |
| `c` | Comment on the current line or selected range |
| `s` | Suggestion on the current line or selected range |
| `i` | Issue on the current line or selected range |
| `C` | Comment on the overall response |
| `[` / `]` | Move to the previous / next saved annotation |
| `e` | Edit the active annotation |
| `d` | Delete the active annotation |
| `y` | Finish and prepare the review in Pi's input editor |
| `Esc` | Cancel a selection or leave the reviewer |

`e` and `d` use the annotation selected with `[` / `]`, or the first annotation attached to the current line.

### Write an annotation

Annotation drafts use Pi's multiline editor and cannot submit a message.

| Key | Action |
| --- | --- |
| `Enter` | Insert a newline |
| `Ctrl-s` | Save the draft |
| `Esc` | Cancel the draft without changing saved annotations |

Blank drafts are rejected. If you try to leave after saving annotations, the reviewer asks before discarding them:

| Key | Action |
| --- | --- |
| `y` / `Enter` | Discard saved annotations and leave |
| `n` / `Esc` | Keep the review open |

## Prepared review

Finishing with `y` formats the annotations into a normal, editable Pi prompt:

```markdown
I reviewed your previous response. Please address these annotations.

1. **[COMMENT]** Overall response

   Please keep the explanation focused on the failure mode.

2. **[ISSUE]** Response lines 8-10

   > if (!response.ok) return cachedValue;
   > await save(response.body);
   > return response.body;

   This silently returns stale data for every server error.
   Please distinguish retryable failures from authoritative responses.

3. **[SUGGESTION]** Response line 14

   > const timeout = 0;

   Use a bounded timeout and handle cancellation explicitly.
```

Line annotations include the exact selected response text. Overall annotations contain feedback without a line quote. Multiline annotation bodies retain their line breaks.

The extension calls Pi's editor-loading API only. It never invokes message submission. The prepared text remains in the input editor until you edit, send, or clear it.

## Command behavior and safety

`/comment` deliberately fails closed:

- It accepts no arguments and runs only in Pi's interactive TUI.
- It reads the latest assistant entry from the current session branch.
- The latest assistant response must be completed successfully; it will not skip an aborted response and review an older one.
- Non-text assistant content is ignored.
- Cancelling, finishing without annotations, or encountering an error leaves the existing Pi input unchanged.
- Leaving with saved annotations requires explicit discard confirmation.
- The reviewer never runs an external editor or evaluates shell configuration.
- The prepared review is never submitted automatically.

## Upgrading from 1.x

Version `2.0.0` replaces the external `$VISUAL` / `$EDITOR` workflow with the native response reviewer.

External-editor configuration and free-form edits to a copied full response are no longer supported. The native reviewer instead keeps feedback anchored to immutable logical response lines and prepares a compact review containing only the annotated quotes.

The release was developed against Pi `0.81.1` and is validated against Pi `1.1.0`.

## Development

Install dependencies and run the full check:

```bash
npm install
npm run check
```

The check type-checks the extension, runs the test suite, and verifies the npm package contents.

To try the local checkout in an interactive Pi session:

```bash
pi -e ./extensions/comment-editor/index.ts
```

## License

[MIT](LICENSE)
