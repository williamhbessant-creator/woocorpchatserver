from flask import request, jsonify
from threading import Lock


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


def register_enhancements(app, socketio, supabase, visitor_id_func, openai_client=None):
    presence = Presence()

    if openai_client is not None and not getattr(openai_client, "_woocorp_memory_wrapped", False):
        original_create = openai_client.responses.create

        def create_with_memory(*args, **kwargs):
            try:
                result = supabase.rpc("list_ai_memory", {"p_visitor_hash": visitor_id_func()}).execute()
                memories = result.data or []
                if memories:
                    memory_text = "\n".join(f"- {item.get('memory', '')}" for item in memories if isinstance(item, dict))
                    base = kwargs.get("instructions", "")
                    kwargs["instructions"] = base + "\n\nUseful saved memory about this user (use only when relevant):\n" + memory_text
            except Exception as error:
                print("AI memory context lookup failed:", repr(error))
            return original_create(*args, **kwargs)

        openai_client.responses.create = create_with_memory
        openai_client._woocorp_memory_wrapped = True

    def broadcast_presence():
        users = presence.list_users()
        socketio.emit("presence_update", {"online": len(users), "users": users})

    @app.get("/api/presence")
    def get_presence():
        users = presence.list_users()
        return jsonify({"online": len(users), "users": users})

    @app.get("/api/ai/memory")
    def list_memory():
        try:
            result = supabase.rpc("list_ai_memory", {"p_visitor_hash": visitor_id_func()}).execute()
            return jsonify({"memories": result.data or []})
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
            result = supabase.rpc("add_ai_memory", {"p_visitor_hash": visitor_id_func(), "p_memory": memory}).execute()
            return jsonify({"memory": result.data}), 201
        except Exception as error:
            print("AI memory creation failed:", repr(error))
            return jsonify({"error": "Could not save AI memory."}), 500

    @app.delete("/api/ai/memory/<memory_id>")
    def delete_memory(memory_id):
        try:
            supabase.rpc("delete_ai_memory", {"p_visitor_hash": visitor_id_func(), "p_id": int(memory_id)}).execute()
            return jsonify({"deleted": True})
        except Exception as error:
            print("AI memory deletion failed:", repr(error))
            return jsonify({"error": "Could not delete AI memory."}), 500

    @app.delete("/api/ai/memory")
    def clear_memory():
        try:
            supabase.rpc("clear_ai_memory", {"p_visitor_hash": visitor_id_func()}).execute()
            return jsonify({"deleted": True})
        except Exception as error:
            print("AI memory clear failed:", repr(error))
            return jsonify({"error": "Could not clear AI memory."}), 500

    @socketio.on("connect")
    def enhanced_connect():
        presence.add(request.sid)
        broadcast_presence()

    @socketio.on("disconnect")
    def enhanced_disconnect():
        presence.remove(request.sid)
        broadcast_presence()

    @socketio.on("set_username")
    def set_username(data):
        username = str((data or {}).get("username", "")).strip()[:20] or "Guest"
        presence.update(request.sid, username)
        broadcast_presence()

    @socketio.on("typing")
    def typing(data):
        username = str((data or {}).get("username", "Guest")).strip()[:20] or "Guest"
        socketio.emit("user_typing", {"username": username, "typing": bool((data or {}).get("typing"))}, include_self=False)

    @socketio.on("toggle_reaction")
    def toggle_reaction(data):
        try:
            message_id = int((data or {}).get("message_id"))
            emoji = str((data or {}).get("emoji", "")).strip()
            result = supabase.rpc("toggle_message_reaction", {
                "p_message_id": message_id,
                "p_visitor_hash": visitor_id_func(),
                "p_emoji": emoji,
            }).execute()
            socketio.emit("message_reactions", {"message_id": message_id, "reactions": result.data or {}})
        except Exception as error:
            print("Reaction failed:", repr(error))
