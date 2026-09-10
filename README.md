# Todo

A single-file todo board backed by Supabase. Still one `index.html` you open
straight off disk — no server, no build step, no npm — but the data now lives in
Postgres rather than a file next to it.

## Running it

Double-click `index.html`. Chrome, Edge, Firefox and Safari all work; the File
System Access API is no longer involved, so the old browser restriction is gone.

On first launch you're asked for your Supabase **project URL** and **publishable
key**, then your email and password. Those project values are then kept in
`localStorage`, and supabase-js keeps the session, so normally nothing is asked
again.

To avoid the setup screen entirely — including on a fresh browser profile — copy
`config.local.example.js` to **`config.local.js`** and fill it in. That file is
gitignored and takes precedence over anything typed on screen. It's a `.js` file
rather than `.env` or `.json` because a page opened from `file://` cannot fetch a
sibling file; a script that assigns a global is the only form that loads.

Adding `email` to it prefills the field. Adding `password` as well signs you in
automatically — at the cost of a plaintext password sitting on your disk. It
never reaches the repo, but weigh that before filling it in. Signing out
deliberately overrides auto sign-in for that one page load.

**The app needs an internet connection.** There is no offline mode: without a
route to Supabase it cannot load your board.

## Setting up a fresh project

1. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor.
   It creates a `todo` schema, three tables, row-level security, and a private
   `todo-images` bucket. It is safe to re-run.
2. Add `todo` under **Settings → API → Exposed schemas**. PostgREST only serves
   schemas listed there, and without it every request comes back `404`.
3. Create your user under **Authentication → Users**, and turn **off**
   *Allow new users to sign up*.

Everything lives in a dedicated `todo` schema so one Supabase instance can host
several small projects side by side. Storage buckets are global to the instance,
hence the `todo-` prefix on the bucket and on its policies.

`migrate.html` is the one-shot importer that moved the original `todos.json`
into Supabase. It is kept because it documents the field mapping and would be
the way back in from an export, but it is not needed in normal use.

## Layout

Each **folder** is an independent board — switch between them from the dropdown
in the top left, and add a column with the **+** beside it. Within a folder,
**categories** are the columns, and tasks live inside them. Completed tasks
collapse into a section at the bottom of their column.

A bar along the bottom lists every keyboard shortcut.

## What it does

**Tasks**

- Click a card to open it, or press `Enter` when it has focus. `Space` marks it
  done instead
- Markdown descriptions with a **Write** / **Preview** toggle — bold, italic,
  bulleted and numbered lists, links, and images. Bare URLs are auto-linked
- Star a task to mark it important
- Each card shows its age in days under the checkbox — `3d`, `140d`, `365d`.
  Hover for the exact creation date
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

Paste an image into a description, or use the toolbar button. It uploads to the
private `todo-images` bucket under your user id, and the markdown records it as
`![alt](sb:<uuid>.png)`. Display goes through a one-hour signed URL cached in
memory, so opening the same card repeatedly costs one round trip rather than one
per view.

**Search**

`Ctrl+F` searches subjects and descriptions within the current folder.

**Housekeeping**

The folder dropdown has **Clear completed > 90 days**, which permanently removes
completed tasks older than that. It asks first.

It also has **Export everything as JSON**, which downloads every folder, category
and task in the same shape the original `todos.json` used — readable by eye, and
importable through `migrate.html` if you ever need to rebuild a project. Images
are not included: they live in Storage, and the export only carries the `sb:`
reference to them.

Worth doing occasionally. The free Supabase tier takes no automatic backups, so
this export is the only copy of your data that isn't in the database.

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

## How saving works

This is the part that keeps the app instant despite a database behind it.

Every edit changes an in-memory object and re-renders synchronously — the same
code path as when a local file backed it, measured at well under a millisecond.
Nothing on the render path ever awaits the network.

Writes happen on a timer. Roughly 800ms after you stop making changes, the app
diffs a snapshot of the whole state against what it last successfully wrote, and
sends only the rows that actually differ. Ids are generated by the client, so
each is a plain upsert. Deletes go before inserts so foreign keys stay satisfied.

Diffing a snapshot rather than tracking dirty rows at each call site also makes
failure boring: if a write fails the snapshot isn't advanced, the dot turns red,
and the next flush retries the same rows. Nothing is lost and nothing has to be
replayed in order.

Hiding the tab flushes immediately. Closing it with an unsaved change still
inside the debounce window prompts before leaving.

The dot in the top right shows the state — saving, saved, or error.

## Your data

Everything lives in your Supabase project, under your user id, behind row-level
security. Every policy keys off `auth.uid()`, which is `NULL` for an
unauthenticated caller and therefore matches no row and permits no insert. That
is why the publishable key being public is not a problem.

Nothing in this repo contains your data or your credentials.

The original `todos.json` and `assets/` are gitignored and no longer read by the
app. Keeping them as a cold backup costs nothing.

## Data model

Three tables in the `todo` schema. Columns are snake_case in Postgres and
camelCase in the app; the mapping happens in one place on load and one on save.

```
folders     id, user_id, name, position, updated_at
categories  id, user_id, folder_id, name, position, updated_at
tasks       id, user_id, folder_id, category_id, subject, description,
            completed, important, due_date, position,
            created_at, completed_at, updated_at
```

`position` is the manual order within a parent, renumbered from zero on every
write. Due-date pinning is applied at render time and never stored, so clearing
a date restores the manual order exactly.

`due_date` is a plain date with no time or zone, so "due today" means today
wherever you are.

## A note on the bundled library

`index.html` contains supabase-js v2.116.0 inlined verbatim as a UMD bundle,
which accounts for most of its size. It's inlined rather than imported because an
ES module import is CORS-checked and would be refused on `file://`, and a CDN
fetch would make startup depend on a third party. To upgrade, replace that one
`<script>` block with a newer UMD build.

`TODO_APP_SPEC.md` holds the original build spec, from when this was a local-file
app. It's kept for history and no longer describes the implementation.
