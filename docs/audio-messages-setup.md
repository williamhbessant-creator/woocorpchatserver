# Public audio messages setup

The audio feature uses the existing \`SUPABASE_PUBLISHABLE_KEY\`; it does **not** need \`SUPABASE_SECRET_KEY\`.

## One-time Supabase setup

1. Open the Supabase project connected to Woocorp Chat.
2. Go to **SQL Editor** and create a new query.
3. Copy all of \`audio-messages-setup.sql\` into the query and run it.
4. Check that the \`audio_messages\` table exists and that the \`audio-messages\` Storage bucket is public with a 10 MB file limit.

## Deploy

Merge this pull request into \`main\`. Render is configured to deploy the \`main\` branch automatically. No new secret environment variable is required. Keep \`FLASK_SECRET_KEY\` configured to a strong random value in Render for secure Flask sessions.

## Limits and privacy

- Maximum recording duration: 3 minutes.
- Maximum file size: 10 MB.
- The page shows the latest 100 recordings.
- Audio files are public: anyone who visits the page or obtains a public audio URL can listen.
- The publishable key is designed for client use; Row Level Security and Storage policies permit public metadata reads, new metadata inserts, and audio uploads.
- The page intentionally does not offer public deletion, because public delete permissions would let visitors delete each other's recordings.
- Do not use this setup for private messages, sensitive recordings, or confidential data. Public uploads can also be abused; the file-size limit is not a complete spam-prevention system.
