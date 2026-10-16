# Audio messages setup

This feature adds a separate \`/audio\` page to Woocorp Chat. It uses the existing Flask server and stores audio in a **private Supabase Storage bucket**.

## Supabase setup

1. Run \`docs/audio-messages-setup.sql\` in the Supabase SQL Editor.
2. The server creates the private \`audio-messages\` bucket automatically on startup when \`SUPABASE_SECRET_KEY\` is configured. It limits files to 10 MB and the supported audio MIME types.
3. If the new table is not available through the Data API, enable \`public\` under Supabase **Project Settings → Data API → Exposed schemas**. The table is RLS-enabled and grants direct table access only to \`service_role\`; do not grant public access.

## Render setup

In the Render service Environment settings, add \`SUPABASE_SECRET_KEY\` with your Supabase project's secret key. Keep it on the server only; never put it in browser JavaScript or commit it to GitHub. The app already reads \`SUPABASE_URL\`.

Also make sure \`FLASK_SECRET_KEY\` is set to a long, random secret so session cookies cannot be forged. Do not use the development fallback for a public production deployment.

## Deploy and test

Merge the feature branch into main after reviewing it, then deploy the Render service. Visit \`/audio\` over HTTPS and allow microphone access.

Recordings are limited to 3 minutes and 10 MB. The page lists the latest 100 recordings. Signed playback URLs expire after one hour and refresh when the list reloads. Anyone visiting the page can listen; only the browser session that created a recording can delete it. Clearing cookies can remove that browser's deletion access, so this is a lightweight ownership model rather than account authentication.
