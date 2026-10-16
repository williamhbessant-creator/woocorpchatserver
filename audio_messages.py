"""Persistent public audio recording routes for Woocorp Chat."""
import os
import re
import uuid
from datetime import datetime, timezone

from flask import jsonify, render_template, request, session
from supabase import create_client

BUCKET = "audio-messages"
MAX_BYTES = 10 * 1024 * 1024
MAX_DURATION_SECONDS = 180
MIME_EXTENSIONS = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
}


def register_audio_routes(app, supabase_url, publishable_key):
    # The publishable key is intended for public/client use. RLS and Storage
    # policies in docs/audio-messages-setup.sql control what it can access.
    storage_client = create_client(supabase_url, publishable_key)

    def owner_id():
        if "audio_owner_id" not in session:
            session["audio_owner_id"] = str(uuid.uuid4())
        return session["audio_owner_id"]

    def public_url(path):
        result = storage_client.storage.from_(BUCKET).get_public_url(path)
        if isinstance(result, str):
            return result
        return result.get("publicUrl") or result.get("public_url") or ""

    @app.get("/audio")
    def audio_page():
        return render_template("audio.html")

    @app.get("/api/audio")
    def list_audio():
        try:
            rows = (storage_client.table("audio_messages")
                    .select("id,title,path,duration_seconds,owner_id,created_at")
                    .order("created_at", desc=True).limit(100).execute().data or [])
            items = [{
                "id": row["id"],
                "title": row["title"],
                "duration_seconds": row["duration_seconds"],
                "created_at": row["created_at"],
                "url": public_url(row["path"]),
                "can_delete": False,
            } for row in rows]
            return jsonify({"messages": items})
        except Exception:
            app.logger.exception("Could not list audio messages")
            return jsonify({"error": "Could not load recordings. Run docs/audio-messages-setup.sql in Supabase and check the audio-messages bucket."}), 500

    @app.post("/api/audio")
    def upload_audio():
        uploaded = request.files.get("audio")
        if uploaded is None:
            return jsonify({"error": "No audio recording was provided."}), 400
        audio_bytes = uploaded.read(MAX_BYTES + 1)
        if not audio_bytes:
            return jsonify({"error": "The recording is empty."}), 400
        if len(audio_bytes) > MAX_BYTES:
            return jsonify({"error": "Recordings must be 10 MB or smaller."}), 413

        mime = (uploaded.mimetype or "").lower().split(";", 1)[0].strip()
        extension = MIME_EXTENSIONS.get(mime)
        if not extension:
            return jsonify({"error": "Unsupported audio format. Try an up-to-date browser."}), 415

        try:
            try:
                duration = int(request.form.get("duration_seconds", "0"))
            except (ValueError, TypeError):
                duration = 0
            duration = max(0, min(duration, MAX_DURATION_SECONDS))
            title = re.sub(r"\s+", " ", request.form.get("title", "Voice message")).strip()[:80] or "Voice message"
            owner = owner_id()
            message_id = str(uuid.uuid4())
            path = owner + "/" + message_id + "." + extension
            storage_client.storage.from_(BUCKET).upload(
                path, audio_bytes,
                file_options={"content-type": mime, "cache-control": "3600", "upsert": "false"},
            )
            created_at = datetime.now(timezone.utc).isoformat()
            storage_client.table("audio_messages").insert({
                "id": message_id, "title": title, "path": path,
                "duration_seconds": duration, "owner_id": owner, "created_at": created_at,
            }).execute()
            return jsonify({"message": {
                "id": message_id, "title": title, "duration_seconds": duration,
                "created_at": created_at, "url": public_url(path), "can_delete": False,
            }}), 201
        except Exception:
            app.logger.exception("Audio upload failed")
            return jsonify({"error": "Could not save recording. Run the Supabase setup SQL and confirm public upload policies are configured."}), 500

    # Deliberately no public delete route: publishable-key policies must not
    # let one visitor delete recordings uploaded by another visitor.
