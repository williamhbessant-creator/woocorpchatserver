# Audio messages setup

This feature adds a separate \`/audio\` page to Woocorp Chat. It uses the existing Flask server and stores audio in a **private Supabase Storage bucket**.

## Supabase setup

1. Create a private Storage bucket named \`audio-messages\`.
2. Set the bucket file-size limit to 10 MB and allow audio/webm, audio/ogg, audio/mp4, audio/mpeg, and audio/wav.
3. Review and run \`docs/audio-messages-setup.sql\` in the Supabase SQL Editor.

## Render setup

In the Render service Environment settings, add \`SUPABASE_SECRET_KEY\` with your Supabase project's secret key. Keep it on the server only; never put it in browser JavaScript or commit it to GitHub. The app already reads \`SUPABASE_URL\`.

## Deploy and test

Merge the feature branch into main after reviewing it, then deploy the Render service. Visit \`/audio\` over HTTPS and allow microphone access.

Recordings are limited to 3 minutes and 10 MB. The page lists the latest 100 recordings. Signed playback URLs expire after one hour and refresh when the list reloads. Anyone visiting the page can listen; only the browser session that created a recording can delete it. Clearing cookies can remove that browser's deletion access, so this is a lightweight ownership model rather than account authentication.
