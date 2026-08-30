from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import os
from datetime import datetime
from supabase import create_client
from openai import OpenAI
import hashlib

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_PUBLISHABLE_KEY"]
AI_KEY = os.environ.get("AI_KEY")
AI_MAX_USES = 5

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "development-secret")
socketio = SocketIO(app, cors_allowed_origins="*")
openai_client = OpenAI(api_key=AI_KEY) if AI_KEY else None


def ai_user_id():
    forwarded = request.headers.get("X-Forwarded-For", "")
    ip = forwarded.split(",")[0].strip() if forwarded else request.remote_addr
    return hashlib.sha256((ip or "unknown").encode("utf-8")).hexdigest()


def get_ai_usage(visitor_id):
    result = (supabase.table("ai_usage")
              .select("uses, infinite")
              .eq("visitor_id", visitor_id)
              .limit(1)
              .execute())
    if not result.data:
        return 0, False
    row = result.data[0]
    return int(row.get("uses", 0) or 0), bool(row.get("infinite", False))


def increment_ai_uses(visitor_id):
    result = supabase.rpc("increment_ai_usage", {"p_visitor_id": visitor_id}).execute()
    return int(result.data)


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/ai/usage")
def ai_usage():
    try:
        used, infinite = get_ai_usage(ai_user_id())
        if infinite:
            return jsonify({"uses_remaining": "∞", "unlimited": True, "infinite": True})
        return jsonify({
            "uses_remaining": max(0, AI_MAX_USES - used),
            "unlimited": False,
            "infinite": False
        })
    except Exception as error:
        print("Supabase usage lookup failed:", repr(error))
        return jsonify({"error": "Could not check your AI usage."}), 500


@app.post("/api/ai")
def ai_assistant():
    if openai_client is None:
        return jsonify({"error": "AI_KEY is not configured on the server."}), 500

    visitor_id = ai_user_id()
    try:
        used, infinite = get_ai_usage(visitor_id)
        if not infinite and used >= AI_MAX_USES:
            return jsonify({
                "error": "You have no AI uses remaining.",
                "uses_remaining": 0,
                "unlimited": False,
                "infinite": False
            }), 429

        data = request.get_json(silent=True) or {}
        message = str(data.get("message", "")).strip()
        history = data.get("history", [])
        if not message:
            return jsonify({"error": "Please enter a message."}), 400
        if len(message) > 2000:
            return jsonify({"error": "Message is too long."}), 400

        conversation = []
        if isinstance(history, list):
            for item in history[-12:]:
                if isinstance(item, dict) and item.get("role") in ("user", "assistant") and str(item.get("content", "")).strip():
                    conversation.append({"role": item["role"], "content": str(item["content"])[:4000]})
        conversation.append({"role": "user", "content": message})

        response = openai_client.responses.create(
            model="gpt-4.1-mini",
            instructions="You are the AI assistant inside Woocorp Public Chat. Be helpful, concise, friendly, and clear.",
            input=conversation,
        )

        if infinite:
            return jsonify({
                "response": response.output_text,
                "uses_remaining": "∞",
                "unlimited": True,
                "infinite": True
            })

        used = increment_ai_uses(visitor_id)
        return jsonify({
            "response": response.output_text,
            "uses_remaining": max(0, AI_MAX_USES - used),
            "unlimited": False,
            "infinite": False
        })
    except Exception as error:
        print("AI request failed:", repr(error))
        return jsonify({"error": "The AI assistant could not get a response."}), 502


@socketio.on("request_history")
def send_history():
    try:
        response = (supabase.table("messageport5555")
                    .select("id, username, message, timestamp, protected")
                    .order("id").limit(500).execute())
        rows = [(row["id"], row["username"], row["message"], row["timestamp"], bool(row.get("protected", False))) for row in response.data]
        emit("chat_history", rows)
    except Exception as error:
        print("History load failed:", repr(error))
        emit("message_action_error", {"error": f"Could not load chat messages: {error}"})


@socketio.on("send_message")
def handle_message(data):
    try:
        username = str(data.get("username", "")).strip()[:20]
        message = str(data.get("message", "")).strip()[:500]
        if not username:
            emit("message_action_error", {"error": "Please enter a username."})
            return
        if not message:
            emit("message_action_error", {"error": "Please enter a message."})
            return

        timestamp = datetime.now().strftime("%H:%M:%S")
        supabase.table("messageport5555").insert({
            "username": username,
            "message": message,
            "timestamp": timestamp
        }).execute()

        result = (supabase.table("messageport5555")
                  .select("id, username, message, timestamp, protected")
                  .eq("username", username)
                  .eq("message", message)
                  .eq("timestamp", timestamp)
                  .order("id", desc=True)
                  .limit(1)
                  .execute())

        if not result.data:
            raise RuntimeError("Message was inserted but could not be read back from Supabase.")

        row = result.data[0]
        socketio.emit("new_message", {
            "id": row["id"],
            "username": row["username"],
            "message": row["message"],
            "timestamp": row["timestamp"],
            "protected": bool(row.get("protected", False))
        })
    except Exception as error:
        print("Send message failed:", repr(error))
        emit("message_action_error", {"error": f"Could not send the message: {error}"})


@socketio.on("delete_message")
def delete_message(data):
    try:
        message_id = int(data.get("id"))
        result = (supabase.table("messageport5555").select("id, protected").maybe_single().eq("id", message_id).execute())
        if not result.data:
            emit("message_action_error", {"error": "Message not found."})
            return
        if bool(result.data.get("protected", False)):
            emit("message_action_error", {"error": "That message is protected from deletion."})
            return
        supabase.table("messageport5555").delete().eq("id", message_id).execute()
        socketio.emit("message_deleted", {"id": message_id})
    except Exception as error:
        print("Delete message failed:", repr(error))
        emit("message_action_error", {"error": f"Could not delete the message: {error}"})


@socketio.on("toggle_message_protection")
def toggle_message_protection(data):
    try:
        message_id = int(data.get("id"))
        result = (supabase.table("messageport5555").select("id, protected").maybe_single().eq("id", message_id).execute())
        if not result.data:
            emit("message_action_error", {"error": "Message not found."})
            return
        new_protected = not bool(result.data.get("protected", False))
        supabase.table("messageport5555").update({"protected": new_protected}).eq("id", message_id).execute()
        socketio.emit("message_protection_changed", {"id": message_id, "protected": new_protected})
    except Exception as error:
        print("Protection change failed:", repr(error))
        emit("message_action_error", {"error": f"Could not change message protection: {error}"})


@socketio.on("clear_history")
def clear_history():
    try:
        supabase.table("messageport5555").delete().eq("protected", False).execute()
        socketio.emit("history_cleared")
    except Exception as error:
        print("Clear history failed:", repr(error))
        emit("message_action_error", {"error": f"Could not clear the chat: {error}"})


if __name__ == "__main__":
    print("=" * 45)
    print(" Public Chat Server")
    print("=" * 45)
    print("Port: 5555")
    print("Database:", SUPABASE_URL)
    print("AI:", "enabled" if AI_KEY else "disabled - AI_KEY missing")
    print("=" * 45)
    socketio.run(app, host="0.0.0.0", port=5555)
