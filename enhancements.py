from collections import defaultdict
from threading import Lock
from flask import request, jsonify


class Presence:
    def __init__(self):
        self.lock = Lock()
        self.users = {}

    def add(self, sid, username="Guest"):
        with self.lock:
            self.users[sid] = username or "Guest"
            return len(self.users)

    def update(self, sid, username):
        with self.lock:
            if sid in self.users:
                self.users[sid] = username or "Guest"

    def remove(self, sid):
        with self.lock:
            self.users.pop(sid, None)
            return len(self.users)

    def list_users(self):
        with self.lock:
            return list(self.users.values())


def register_enhancements(app, socketio, supabase, visitor_id_func):
    presence = Presence()

    @app.get("/api/presence")
    def get_presence():
        return jsonify({"online": len(presence.list_users()), "users": presence.list_users()})

    @app.get("/api/ai/memory")
    def list_memory():
        try:
            rows = (supabase.table("ai_memory")
                    .select("id,memory,created_at,updated_at")
                    .eq("visitor_hash", visitor_id_func())
                    .order("updated_at", desc=True)
                    .limit(100).execute())
            return jsonify({"memories": rows.data or []})
        except Exception as error:
            print("AI memory lookup failed:", repr(error))
            return jsonify({"error": "Could not load AI memory."}), 500

    @app.post("/api/ai/memory")
    def add_memory():
        try:
            data = request.get_json(silent=True) or {}
            memory = str(data.get("memory", "")).strip()[:500]
            if not memory:
                return jsonify({"error": "Memory cannot be empty."}), 400
            result = (supabase.table("ai_memory")
                      .insert({"visitor_hash": visitor_id_func(), "memory": memory})
                      .execute())
            return jsonify({"memory": (result.data or [{}])[0]}), 201
        except Exception as error:
            print("AI memory creation failed:", repr(error))
            return jsonify({"error": "Could not save AI memory."}), 500

    @app.delete("/api/ai/memory/<memory_id>")
    def delete_memory(memory_id):
        try:
            supabase.table("ai_memory").delete().eq("id", memory_id).eq("visitor_hash", visitor_id_func()).execute()
            return jsonify({"deleted": True})
        except Exception as error:
            print("AI memory deletion failed:", repr(error))
            return jsonify({"error": "Could not delete AI memory."}), 500

    @app.delete("/api/ai/memory")
    def clear_memory():
        try:
            supabase.table("ai_memory").delete().eq("visitor_hash", visitor_id_func()).execute()
            return jsonify({"deleted": True})
        except Exception as error:
            print("AI memory clear failed:", repr(error))
            return jsonify({"error": "Could not clear AI memory."}), 500

    @socketio.on("connect")
    def enhanced_connect():
        count = presence.add(request.sid)
        socketio.emit("presence_update", {"online": count, "users": presence.list_users()})

    @socketio.on("disconnect")
    def enhanced_disconnect():
        count = presence.remove(request.sid)
        socketio.emit("presence_update", {"online": count, "users": presence.list_users()})

    @socketio.on("set_username")
    def set_username(data):
        username = str((data or {}).get("username", "")).strip()[:20] or "Guest"
        presence.update(request.sid, username)
        socketio.emit("presence_update", {"online": len(presence.list_users()), "users": presence.list_users()})

    @socketio.on("typing")
    def typing(data):
        username = str((data or {}).get("username", "Guest")).strip()[:20] or "Guest"
        socketio.emit("user_typing", {"username": username, "typing": bool((data or {}).get("typing"))}, include_self=False)

    @socketio.on("toggle_reaction")
    def toggle_reaction(data):
        try:
            message_id = int((data or {}).get("message_id"))
            emoji = str((data or {}).get("emoji", "")).strip()
            if emoji not in {"👍", "❤️", "😂", "😮", "😢", "🔥"}:
                return
            visitor_hash = visitor_id_func()
            existing = (supabase.table("message_reactions").select("id")
                        .eq("message_id", message_id).eq("visitor_hash", visitor_hash).eq("emoji", emoji)
                        .limit(1).execute())
            if existing.data:
                supabase.table("message_reactions").delete().eq("id", existing.data[0]["id"]).execute()
            else:
                supabase.table("message_reactions").insert({"message_id": message_id, "visitor_hash": visitor_hash, "emoji": emoji}).execute()
            rows = (supabase.table("message_reactions").select("message_id,emoji")
                    .eq("message_id", message_id).execute()).data or []
            counts = defaultdict(int)
            for row in rows:
                counts[row["emoji"]] += 1
            socketio.emit("message_reactions", {"message_id": message_id, "reactions": dict(counts)})
        except Exception as error:
            print("Reaction failed:", repr(error))
