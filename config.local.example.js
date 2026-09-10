// Copy this file to  config.local.js  and fill it in.
// config.local.js is gitignored and never leaves your machine.
//
// It is loaded as a plain <script>, not parsed as JSON or .env — a page opened
// from file:// cannot fetch a sibling file, so a data file next to it would be
// unreadable. A script that assigns a global is the one thing that does work.
//
// If the file is missing, or the URL is still a placeholder, the app simply
// asks for these on screen instead. Nothing breaks.

window.TODO_CONFIG = {
  // Supabase → Settings → API
  url: "https://YOUR-PROJECT.supabase.co",
  key: "sb_publishable_...",

  // Postgres schema this app owns. Must be listed under Exposed schemas.
  schema: "todo",

  // Optional. With just an email you skip typing it and land on the password
  // field. Add a password as well and the app signs in on its own.
  //
  // Note that a password here is stored in plain text on disk. It never reaches
  // the repo, but anyone with your unlocked machine can read it — so add it only
  // if that is a trade you are happy with. Leaving it out costs you one field,
  // and only when the saved session has actually expired.
  email: "",
  password: ""
};
