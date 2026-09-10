# Todo

A single-file todo board that runs straight from your filesystem. No server, no
build step, no account, no network calls. You point it at a folder and it keeps
a `todos.json` file there, alongside any images you paste.

The whole app is one `index.html` — HTML, CSS and JavaScript inlined. Move the
file wherever you like and open it.

## Running it

Open `index.html` in **Microsoft Edge** or **Google Chrome** on desktop, then
click **Choose a folder**. The app creates `todos.json` in that folder on first
use, and an `assets/` subfolder the first time you add an image.

Firefox and Safari won't work — the app uses the
[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
to read and write real files on disk, and neither has shipped it. The app
detects this and says so rather than failing silently.

The folder handle is remembered in IndexedDB, so on later visits you get a
one-click **Reopen** button instead of having to re-pick the folder. Browsers
require a user gesture before re-granting write permission, which is why it's a
button and not automatic.

## Layout

Each **folder** is an independent board — switch between them from the dropdown
in the top left, and add a column with the **+** beside it. Within a folder,
**categories** are the columns, and tasks live inside them. Completed tasks
collapse into a section at the bottom of their column.

A bar along the bottom of the screen lists every keyboard shortcut.

## What it does

**Tasks**

- Click a card to open it, or press `Enter` when it has focus. `Space` marks it
  done instead
- Markdown descriptions with a **Write** / **Preview** toggle — bold, italic,
  bulleted and numbered lists, links, and images. Bare URLs are auto-linked
- Star a task to mark it important
- Each card shows its age under the checkbox — `3d`, `2w`, `5m`, `1y`. Hover for
  the exact creation date
- Drag tasks between columns, or to reorder within one
- Drag a column by its grip to reorder the board
- Double-click a column name to rename it

**Keyboard navigation**

Cards are focusable and the arrow keys move between them: up/down within a
column, left/right to the top of the adjacent column. Completed tasks and empty
columns are skipped. Holding `Ctrl` moves the card itself rather than the focus.

New cards take focus as soon as they're created, so `Enter` opens straight into
the description with the cursor already in it.

**Due dates**

A task can carry an optional due date, set from the task modal or from quick-add.
Within three days of it — overdue included — an incomplete task pins to the top
of its column, sorted soonest-first, and renders in red with an alert icon.
Dated tasks further out show a muted date. Undated tasks look exactly as they
would without the feature.

Pinned cards can't be reordered by hand, since due-date order overrides manual
placement, but they can still be moved between columns.

**Images**

Paste an image straight into a description, or use the toolbar button. The file
is written into `assets/` next to `todos.json` and referenced from the markdown
as `![alt](assets/<uuid>.png)`. Because the images are real files in the folder,
moving or copying the folder takes them along.

**Search**

`Ctrl+F` searches subjects and descriptions within the current folder.

**Housekeeping**

The folder dropdown has **Clear completed > 90 days**, which permanently removes
completed tasks older than that. It asks first.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `N` | New task (when not typing in a field) |
| `↑` `↓` | Move focus within a column |
| `←` `→` | Move focus to the top of the adjacent column |
| `Ctrl` + arrows | Move the focused card itself |
| `Enter` | Open the focused card |
| `Space` | Mark the focused card done |
| `Esc` | Close the topmost dialog (saving edits), or the search bar |
| `Ctrl+F` | Search |
| `Space` | In a task's Preview pane, switch to Write |
| `Ctrl+B` / `Ctrl+I` | Bold / italic, inside a task description |
| `Ctrl+Enter` | Submit from the quick-add description field |

On a Mac use `⌘` — every shortcut accepts either modifier. Note that macOS
intercepts `Ctrl`+arrows for Mission Control, so use `⌘`+arrows to move cards
there. The on-screen legend always says `Ctrl`.

## Saving

Writes are debounced ~300 ms and the full JSON object is rewritten each time.
The dot in the top right shows the current state — saving, saved, or an error.

The app also polls `todos.json` every 5 seconds while the tab is visible. If the
file changed underneath it — edited by hand, or synced in from another machine —
it stops and offers a reload rather than overwriting your changes. It's a guard,
not a merge: reloading discards whatever is unsaved in that tab.

## Your data

`todos.json` and `assets/` are **not** committed to this repo. This repo is
public and those files are your actual notes.

That also means the repo holds the app but not your todos, so cloning it
elsewhere gives you an empty board. To move your data, copy the folder itself —
or keep the folder inside OneDrive or Dropbox and let those sync it.

There is no backup beyond the folder. If you lose it, the todos are gone.

## Data format

```json
{
  "version": 2,
  "folders": [
    {
      "id": "uuid",
      "name": "Personal",
      "categories": [{ "id": "uuid", "name": "Today" }]
    }
  ],
  "tasks": [
    {
      "id": "uuid",
      "folderId": "uuid",
      "categoryId": "uuid",
      "subject": "string",
      "description": "markdown string",
      "completed": false,
      "important": false,
      "dueDate": "YYYY-MM-DD or null",
      "createdAt": "ISO 8601",
      "completedAt": null
    }
  ],
  "activeFolderId": "uuid"
}
```

Plain JSON, readable and editable by hand if you ever need to. Task order within
a category is the array order, except that tasks due within three days are
pinned above the rest at render time.

`dueDate` is a plain date with no time or zone, so "due today" means today
wherever you happen to be. Tasks written before the field existed simply omit
it and read as undated — no migration needed.

`TODO_APP_SPEC.md` holds the original build spec. It's kept for reference and
has drifted from the implementation in places — the code is the source of truth.
