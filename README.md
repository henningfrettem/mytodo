# Todo

A single-file todo board with a notes pane, backed by Supabase. Still one `index.html` you open
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

## Running it as a desktop app

Chrome's **Create shortcut** / **Install page as app** menu item is greyed out
for `file://` pages in current versions — installing as a PWA needs a manifest
served over HTTPS or localhost, and Chrome won't offer it for a local file no
matter what the page declares.

The way through is Chrome's `--app=` flag on an ordinary Windows shortcut:

```
powershell -ExecutionPolicy Bypass -File make-shortcut.ps1
```

That puts a **Todo** shortcut on your desktop, using `todo.ico`, which opens the
app in its own window with no address bar and its own taskbar and Alt-Tab entry.
Right-click it to pin to the taskbar.

The shortcut deliberately does *not* pass `--user-data-dir`. The app window needs
the ordinary Chrome profile: its own profile would mean its own `localStorage`,
so a fresh setup screen and a lost session on every launch.

Hosting the file instead — any static host, no build step — would make it a real
installable PWA on desktop and phone, since the app already needs the network for
Supabase anyway.

## Setting up a fresh project

1. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor.
   It creates a `todo` schema, six tables, row-level security, and a private
   `todo-images` bucket. It is safe to re-run, and re-running it is also how an
   existing project picks up tables added later, such as the notes tables.
   Until those exist the board works as usual and the notes pane says what to
   run.
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

To the left of the board is the **notes** pane, which belongs to the folder too:
switching folders switches the notes. Drag its right edge to make it wider or
narrower (double-click the edge to reset), or fold it away with `«`. Both are
remembered on this machine.

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

`←` from the first column moves into the notes pane, where up/down walk the
category headers and notes, `Enter` opens a note or folds a category, and `→`
goes back to the board.

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

**Private cards and columns**

A single card can be marked private from the eye button in its detail modal,
next to the star. It renders blurred on the board with a small eye-off marker
beside it, and opening the card shows the real text straight away — there is no
reveal toggle, because opening it is already the deliberate act.

A column can be marked private in its settings (the gear in the column header).
Its card text renders blurred and unselectable, and an eye in the header reveals
it. Revealing lasts only for that session — a private column always comes back
blurred when the app is opened, and turning privacy off and on again never
restores an old reveal.

Search respects both: a match on a private card, or inside a hidden private
column, is blurred in the results and badged **Private**, so the dialog can't be
used to read around the blur. Press `Enter` to open it and read it properly.

This is a screen-privacy measure, not a security one. The rows are ordinary text
in the database and in the JSON export, and opening a card shows it in full. It
stops someone reading your board over your shoulder; it does not protect anything
from someone with access to the data.

**Notes**

The pane on the left is a OneNote-style notebook for the current folder. Notes
sit in categories you create with **+ New category**; each note takes a single
line in the list, showing its heading, how many entries it has when there's more
than one, and when the latest entry was written. Click a category to fold it.

**New note** at the top of the pane (or `Shift+N`) opens a new note in a large
window, in whichever category you used last. The `+` on a category's header
picks one instead. Every note needs a heading: closing a note that has text but
no heading is refused until you give it one, and a new note closed with nothing
written in it is simply discarded.

Inside, a note is a thread of **entries**, each stamped with the date and time
it was written, newest on top. That suits things like weekly 1:1s, where every
meeting adds an entry to the same note; most notes will only ever have one.
**New entry** (or `Ctrl+Enter`) adds one at the top.

Entries are rich text and always editable: click anywhere in one and type, with
no edit mode to switch into. The toolbar does bold, italic, bulleted and
numbered lists, links and images; `Ctrl+B`, `Ctrl+I` and `Ctrl+K` (link) work
too, typing `- ` or `1. ` at the start of a line starts a list, and `Tab`
indents a list item. Bare URLs become links when you leave the entry, and a
link opens with a single click. Paste an image, or drop one on an entry, and it
appears at once and uploads to the same private bucket as card images.

Pasting from a web page or Word keeps the basic formatting (bold, italic,
lists, links, headings as bold lines) and drops everything else. What an entry
may contain is a short whitelist, rebuilt from scratch on every paste and every
load, so styles, scripts and event handlers from a pasted page can't come along.

Reordering is by drag and drop throughout: entries by the handle to their left
(their timestamps stay as they were), notes within and between categories (drop
on a category's header to put a note at its top), and categories by their
header. The category dropdown in the note window moves a note too.

**Task lists** turn lines in a note into cards. Start one with the task-list
button in the toolbar or by typing `[] ` at the start of a line, or select lines
you've already written (or a bulleted or numbered list) and press the button to
convert them all at once. Each line becomes a card at the top of the folder's
first column, in the list's order, when you finish it: on `Enter`, or when you
leave the entry. A line still being typed has a dashed box and no card yet.

The card holds the text, the done state and the due date; the line in the note
only points at it and shows it, so the two can't disagree. Tick a line and the
card is done; complete the card on the board and the line is ticked. Edit the
text in either place and both change. A due date shows beside the line, red
with the alert icon when it's within three days. Lines are plain text, like a
card's title.

Hover a line for a small arrow, or press `Alt+Enter` in it, to open its card on
top of the note, which is where you set a due date, a description or a star.
The card shows **From note: …** in its window, and a small note icon on the
board; clicking the link opens the note at that line.

Removing a line from the note deletes its card when you leave the entry, with
Undo, which brings back the card and the line. While you're still typing,
`Ctrl+Z` gets the line back without the board ever noticing, and cutting a line
and pasting it elsewhere keeps its card. A pasted *copy* of a line becomes plain
text, so one card never has two lines. If the card is deleted on the board, or
cleared as an old completed task, its line stays in the note as plain text: the
note is still a record of what was said. Deleting or archiving a whole note, or
one of its entries, leaves the cards on the board. A private note, or a note in
a private category, makes private cards.

**Archive** in the note window takes a note out of the list without deleting
it. Archived notes collect in an **Archived** section at the bottom of the pane,
still openable and still searchable; **Unarchive** puts one back where it was.
Deleting a note or an entry offers undo.

Notes can be private in the same two ways as cards: a single note, from the eye
in its window, or a whole category, from its settings (the gear on its header).
Private titles are blurred in the pane, a category's eye reveals it for the
session, and opening a note always shows it in full.

**Search**

`Ctrl+F` opens a search dialog in the middle of the screen. It covers cards
(subjects and descriptions) and notes (headings and entries) in the **current
folder**, including **completed** tasks and **archived** notes, which a board
filter could never have surfaced. Matching notes are listed in their own group
under the cards. Tick
**All folders** in the footer to widen it; that resets to the current folder each
time the dialog opens.

Arrow keys move through the results, `Enter` opens the highlighted card or note
on top of the dialog with the search still underneath, and `Esc` closes it first
and the search second. Each result shows its column — and its folder too when
searching all folders — a snippet of the
notes when the match was there rather than in the subject, and a badge if the
task is done or due. Opening a result in another folder switches the board to it.

**Housekeeping**

The folder dropdown has **Clear completed > 90 days**, which permanently removes
completed tasks in **the current folder** finished more than 90 days ago. Other
folders are untouched. It asks first, naming the folder and the count.

There is no undo — the rows are deleted from the database — so export first if
you want a copy. Images used by those tasks stay in storage; nothing collects
them.

It also has **Export everything as JSON**, which downloads every folder, category
and task in the same shape the original `todos.json` used — readable by eye, and
importable through `migrate.html` if you ever need to rebuild a project. It
also carries every note category, note and entry, archived ones included.
Images are not included: they live in Storage, and the export only carries a
reference to them.

Worth doing occasionally. The free Supabase tier takes no automatic backups, so
this export is the only copy of your data that isn't in the database.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `N` | New task (when not typing in a field) |
| `Shift+N` | New note |
| `↑` `↓` | Move focus within a column |
| `←` `→` | Move focus to the top of the adjacent column; `←` from the first column moves into the notes pane |
| `Ctrl` + arrows | Move the focused card itself |
| `Enter` | Open the focused card or note; on a notes category, fold or unfold it |
| `Space` | Mark the focused card done |
| `Esc` | Close the topmost dialog (saving edits), then the search |
| `Ctrl+F` | Search |
| `Space` | In a task's Preview pane, switch to Write |
| `Ctrl+B` / `Ctrl+I` | Bold / italic, inside a task description |
| `Ctrl+Enter` | Submit from the quick-add description field; in a note, add an entry |
| `Ctrl+K` | In a note, link the selected text |
| `[]` + `Space` | In a note, start a task list |
| `Alt+Enter` | On a task-list line, open its card |
| `Tab` / `Shift+Tab` | In a note's list, indent / outdent |

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

Six tables in the `todo` schema. Columns are snake_case in Postgres and
camelCase in the app; the mapping happens in one place on load and one on save.

```
folders     id, user_id, name, position, updated_at
categories  id, user_id, folder_id, name, private, position, updated_at
tasks       id, user_id, folder_id, category_id, subject, description,
            completed, important, private, due_date, position,
            created_at, completed_at, updated_at

note_categories  id, user_id, folder_id, name, private, position, updated_at
notes            id, user_id, category_id, title, private, archived,
                 archived_at, position, created_at, updated_at
note_entries     id, user_id, note_id, body, position, created_at, updated_at
```

An entry's `body` is the sanitised HTML described under Notes. A task list is
`<ul data-tasks>` with `<li data-task="<card id>">` lines; the id is the only
link between a line and its card, and everything a line displays (ticked, due
date) is read from the card when the note is drawn. Images in it are
`<img data-sb="<uuid>.png">`, a reference into the bucket and never a URL, since
signed URLs expire. An entry's `created_at` is the timestamp it shows, and
reordering entries changes only `position`.

A note's heading is required by the app but deliberately not by the database: a
note is saved while it's being written, before it has a heading, and a
constraint would turn that into lost text.

Every table is read in pages of 1000 rows, the most PostgREST returns in one
response.

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
