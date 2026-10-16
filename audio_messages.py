"""Persistent audio recording routes for Woocorp Chat."""
import os
import re
import uuid
from datetime import datetime, timezone

from flask import jsonify, render_template, request, session
from supabase import create_client

BUCKET = "audio-messages"
MAX_BYTES = 10 * 1024 * 1024
MIME_EXTENSIONS = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
}


def register_audio_routes(app, supabase_url):
    secret = os.environ.get("SUPABASE_SECRET_KEY")
    storage_client = create_client(supabase_url, secret) if secret else None

    def owner_id():
        if "audio_owner_id" not in session:
            session["audio_owner_id"] = str(uuid.uuid4())
        return session["audio_owner_id"]

    def ready():
        if storage_client is None:
            return jsonify({"error": "Audio storage is not configured. Add SUPABASE_SECRET_KEY to the Render environment."}), 503
        return None

    def signed_url(path):
        result = storage_client.storage.from_(BUCKET).create_signed_url(path, 3600)
        return result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")

    @app.get("/audio")
    def audio_page():
        return render_template("audio.html")

    @app.get("/api/audio")
    def list_audio():
        error = ready()
        if error:
            return error
        try:
            rows = (storage_client.table("audio_messages")
                    .select("id,title,path,duration_seconds,owner_id,created_at")
                    .order("created_at", desc=True).limit(100).execute().data or [])
            items = []
            for row in rows:
                items.append({
                    "id": row["id"], "title": row["title"],
                    "duration_seconds": row["duration_seconds"],
                    "created_at": row["created_at"], "url": signed_url(row["path"]),
                    "can_delete": row["owner_id"] == owner_id(),
                })
            return jsonify({"messages": items})
        except Exception:
            app.logger.exception("Could not list audio messages")
            return jsonify({"error": "Could not load saved recordings. Check the audio table and private Storage bucket."}), 500

    @app.post("/api/audio")
    def upload_audio():
        error = ready()
        if error:
            return error
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
            duration = max(0, min(duration, 180))
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
            item = {
                "id": message_id, "title": title, "duration_seconds": duration,
                "created_at": created_at, "url": signed_url(path), "can_delete": True,
            }
            return jsonify({"message": item}), 201
        except Exception:
            app.logger.exception("Audio upload failed")
            return jsonify({"error": "Could not save recording. Check Supabase bucket, table, and server key setup."}), 500

    @app.delete("/api/audio/<message_id>")
    def delete_audio(message_id):
        error = ready()
        if error:
            return error
        try:
            message_id = str(uuid.UUID(message_id))
        except (ValueError, TypeError, AttributeError):
            return jsonify({"error": "Invalid recording ID."}), 400
        try:
            result = (storage_client.table("audio_messages")
                      .select("id,path,owner_id").eq("id", message_id)
                      .maybe_single().execute())
            row = result.data
            if not row:
                return jsonify({"error": "Recording not found."}), 404
            if row.get("owner_id") != owner_id():
                return jsonify({"error": "You can only delete recordings created in this browser session."}), 403
            storage_client.storage.from_(BUCKET).remove([row["path"]])
            storage_client.table("audio_messages").delete().eq("id", message_id).eq("owner_id", owner_id()).execute()
            return jsonify({"deleted": True})
        except Exception:
            app.logger.exception("Audio delete failed")
            return jsonify({"error": "Could not delete that recording."}), 500
