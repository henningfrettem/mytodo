# Standalone Local Todo App — Build Spec

## Goal

Build a single-file HTML application that runs locally on Windows 11 without a webserver. The user opens the file in Edge (or Chrome), and the app reads/writes a real `todos.json` file on disk using the File System Access API.

The output must be **one single `index.html` file** containing all HTML, CSS, and JavaScript. No build step, no dependencies, no external CDN calls at runtime (inline everything). The user should be able to put the file anywhere on their laptop, double-click it, and have it work.

## Runtime requirements

- Target browsers: Microsoft Edge and Google Chrome on Windows 11
- Use the File System Access API (`window.showOpenFilePicker`, `window.showSaveFilePicker`, `FileSystemFileHandle`) for reading and writing `todos.json`
- On first launch, prompt the user to either open an existing `todos.json` or create a new one
- Persist the file handle across reloads using IndexedDB (handles survive page reload if the user re-grants permission) so the user doesn't have to re-pick the file on every visit
- If the File System Access API is unavailable (wrong browser), show a clear message and fall back to download/upload of the JSON file

## Data model

```json
{
  "version": 1,
  "folders": [
    {
      "id": "uuid",
      "name": "Personal",
      "categories": [
        { "id": "uuid", "name": "Today" },
        { "id": "uuid", "name": "This week" },
        { "id": "uuid", "name": "Someday" }
      ]
    }
  ],
  "tasks": [
    {
      "id": "uuid",
      "folderId": "uuid",
      "categoryId": "uuid",
      "subject": "string",
      "description": "html string (rich text)",
      "completed": false,
      "createdAt": "ISO 8601 timestamp",
      "completedAt": null
    }
  ]
}
```

- IDs are UUIDs (use `crypto.randomUUID()`)
- Sort order within a category is always `createdAt` ascending — newest at the bottom, oldest at the top. No manual reordering within a category.
- Tasks can be moved **between categories** via drag-and-drop; this updates `categoryId` but not `createdAt`.
- All writes to the JSON file are debounced (~300 ms) and atomic (write the full object).

## Layout

Optimized for wide screens (1440px and up, but works down to ~1100px).

```
┌───────────────────────────────────────────────────────────────────────┐
│  [Folder: Personal ▼]   [+ New task (Ctrl+N)]          todos.json ●   │
├───────────────────────────────────────────────────────────────────────┤
│  ┌─Today──────────┐  ┌─This week──────┐  ┌─Someday────────┐  ┌─ + ─┐ │
│  │ + add task...  │  │ + add task...  │  │ + add task...  │  │     │ │
│  │                │  │                │  │                │  │     │ │
│  │ □ Task 1       │  │ □ Task A       │  │ □ Task X       │  │     │ │
│  │ □ Task 2       │  │ □ Task B       │  │                │  │     │ │
│  │ □ Task 3       │  │                │  │                │  │     │ │
│  │                │  │                │  │                │  │     │ │
│  │ ▸ Completed(4) │  │ ▸ Completed(1) │  │ ▸ Completed(0) │  │     │ │
│  └────────────────┘  └────────────────┘  └────────────────┘  └─────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

### Top bar

- **Folder selector**: dropdown at the top-left showing the active folder. Clicking it reveals all folders plus a "Manage folders…" option that opens a modal for rename/add/delete.
- **New task button**: prominent, also shows the `Ctrl+N` shortcut hint.
- **File status indicator**: filename + a colored dot (green = saved, amber = saving, red = error / no file handle).

### Board

- Each category is a column, laid out horizontally. Columns have equal flexible width and fill the viewport.
- At the top of each column: an always-visible single-line input "+ add task...". Pressing Enter in this input creates a task with that subject in that category, with empty description. Focus returns to the input after submit so the user can type several in a row.
- Below the inputs: the open tasks for that category, sorted by `createdAt` ascending.
- At the bottom of each column: a collapsed "▸ Completed (N)" section. Clicking expands it inline to show completed tasks (struck-through, greyed out) with the ability to un-complete or delete them.
- A trailing "+ add category" column (narrow, dashed border) lets the user add new categories to the current folder.

### Task card

- Single-line subject, truncated with ellipsis if too long.
- Checkbox on the left to toggle complete.
- Clicking anywhere on the card (except the checkbox) opens the task detail modal.
- Hovering shows a small delete icon (with confirm).
- Tasks are draggable between category columns (not reorderable within a column).

### Task detail modal

- Subject (single-line input, autofocused on open).
- Description (rich text editor).
- Category (dropdown, scoped to the current folder's categories).
- Metadata footer: created date, completed date (if applicable).
- Delete button (with confirm).
- Close on Escape or clicking outside. Auto-save on change (debounced).

## Quick-add modal (Ctrl+N)

Global keyboard shortcut `Ctrl+N` opens a modal:

- Autofocused subject input.
- Category selector (defaults to the first category of the current folder; remembers last-used across modal opens in this session).
- Optional description field (rich text, collapsed by default behind a "+ add description" toggle).
- Enter submits; Shift+Enter inserts a newline in description; Escape cancels.
- After submit, the modal closes and focus returns to wherever the user was.

**Important**: `Ctrl+N` in browsers normally opens a new window. You must call `event.preventDefault()` on the keydown. Note this only works when the page is focused — this is fine for our use case.

## Rich text editor

Use `contenteditable` with a minimal inline toolbar that appears on selection (bold, italic, underline, bullet list, numbered list, link). Use `document.execCommand` for simplicity — yes, it's deprecated, but for a single-user local app it's the lowest-complexity option that works and doesn't require a dependency. Store the description as the `innerHTML` of the editor.

Sanitize the HTML on read (whitelist tags: `b, i, u, strong, em, ul, ol, li, a, br, p, span`) to avoid any issues if the JSON file is ever hand-edited.

## Folder management

- Modal with a list of folders.
- Rename inline (click name → edit).
- Add folder: input + "Create" button. A new folder starts with three default categories: "Today", "This week", "Someday".
- Delete folder: requires confirmation. Warns if the folder has tasks. Deleting removes the folder, its categories, and all its tasks.
- At least one folder must always exist. If the JSON file has no folders on load, create a default "Personal" folder.

## Category management (within a folder)

- Rename: double-click the category header.
- Delete: small icon on hover in the category header, with confirm. If the category has tasks, offer to move them to another category or delete them.
- Add: the trailing "+ add category" column at the right end of the board.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Ctrl+N` | Open quick-add modal |
| `Esc` | Close any open modal |
| `Enter` (in quick-add input) | Save and close |
| `Enter` (in column quick-add input) | Save task, keep focus in input |

## Visual style

- Clean, Trello-ish but lighter. System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`).
- Light theme only (for now). Subtle shadows, rounded corners (6–8px), generous whitespace.
- Category columns: light grey background (`#f4f5f7`), white task cards with a thin border.
- No icons library — use inline SVG for the few icons needed (checkbox, drag handle, delete, chevron).
- No external fonts, no external CSS, no external JS.

## File handling details

1. On app load: try to restore the saved file handle from IndexedDB. If found, call `handle.requestPermission({ mode: 'readwrite' })`. If granted, read the file and load the data.
2. If no handle or permission denied: show a welcome screen with two buttons — "Open existing todos.json" and "Create new todos.json".
3. On every data change: debounce 300 ms, then write the full JSON object to the handle. Show the status dot as amber during write, green on success, red on error.
4. Handle the case where the file is deleted or moved externally — show an error and let the user re-pick a file.

## Error handling

- If the JSON file is malformed on load: show an error with the option to "Start fresh" (creates a default structure) or "Pick a different file".
- If writes fail repeatedly: show a persistent error banner.
- Never lose user data silently. If a write fails, keep the in-memory state and keep retrying on the next change.

## Non-goals (do not build)

- No sync, no cloud, no accounts.
- No due dates, priorities, tags, assignees, attachments.
- No search (folders are small enough; can be added later).
- No mobile/narrow layout beyond graceful degradation.
- No dark mode (yet).
- No undo history beyond the current session.

## Deliverable

A single file: `index.html`. The user saves it anywhere on their Windows 11 laptop, double-clicks to open in Edge, picks or creates a `todos.json` file, and is immediately productive.

## Suggested build order

1. Skeleton HTML, CSS layout, welcome screen with file picker.
2. Data model in memory + load/save to JSON file via File System Access API.
3. Handle persistence in IndexedDB so the file re-opens automatically on reload.
4. Render the board: folder dropdown, category columns, task cards.
5. Column quick-add input.
6. Task detail modal with rich text editor.
7. Completed section (collapsed by default).
8. Ctrl+N quick-add modal.
9. Drag-and-drop between categories.
10. Folder management modal.
11. Category add/rename/delete.
12. Polish: status indicator, error states, empty states.
