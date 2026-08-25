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
in the top left. Within a folder, **categories** are the columns, and tasks live
inside them. Completed tasks collapse into a section at the bottom of their
column.

## What it does

**Tasks**

- Click a card to open it; `Enter` or `Space` when it's focused does the same
- Markdown descriptions with a **Write** / **Preview** toggle — bold, italic,
  bulleted and numbered lists, links, and images
- Star a task to mark it important
- Drag tasks between columns, or to reorder within one
- Drag a column by its grip to reorder the board
- Double-click a column name to rename it

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
| `Ctrl+F` | Search |
| `Esc` | Close the topmost dialog, or the search bar |
| `Enter` | Submit from the quick-add subject field |
| `Ctrl+Enter` | Submit from the quick-add description field |
| `Ctrl+B` / `Ctrl+I` | Bold / italic, inside a task description |

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
      "createdAt": "ISO 8601",
      "completedAt": null
    }
  ],
  "activeFolderId": "uuid"
}
```

Plain JSON, readable and editable by hand if you ever need to. Task order within
a category is the array order.

`TODO_APP_SPEC.md` holds the original build spec. It's kept for reference and
has drifted from the implementation in places — the code is the source of truth.
