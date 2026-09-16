from flask import Flask, render_template, request, jsonify, Response
from flask_socketio import SocketIO, emit
import os
from datetime import datetime
from supabase import create_client
from openai import OpenAI
import hashlib
import uuid

from ai_history import (
    list_conversations,
    get_messages,
    create_conversation,
    save_message,
    rename_conversation,
    delete_conversation,
)
from enhancements import register_enhancements

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_PUBLISHABLE_KEY"]
AI_KEY = os.environ.get("AI_KEY")
AI_MAX_USES = 5
AI_REQUIRED_MESSAGES = 2

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
    result = supabase.rpc("get_ai_usage_info", {"p_visitor_id": visitor_id}).execute()
    data = result.data or {}
    return int(data.get("uses", 0) or 0), bool(data.get("infinite", False))


def increment_ai_uses(visitor_id):
    result = supabase.rpc("increment_ai_usage", {"p_visitor_id": visitor_id}).execute()
    return int(result.data or 0)


def message_owner_id():
    return ai_user_id()


def get_user_message_count(owner_hash):
    result = (supabase.table("messageport5555")
              .select("id")
              .eq("owner_ip_hash", owner_hash)
              .execute())
    return len(result.data or [])


def valid_conversation_id(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/robots.txt")
def robots_txt():
    """Tell search engines that the public homepage may be crawled."""
    content = "User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://woocorpchatserver.onrender.com/sitemap.xml\n"
    return Response(content, mimetype="text/plain")


@app.get("/sitemap.xml")
def sitemap_xml():
    """Provide the canonical public URL to search engines."""
    content = '''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://woocorpchatserver.onrender.com/</loc>
  </url>
</urlset>
'''
    return Response(content, mimetype="application/xml")


@app.get("/api/ai/usage")
def ai_usage():
    try:
        visitor_id = ai_user_id()
        used, infinite = get_ai_usage(visitor_id)
        message_count = get_user_message_count(message_owner_id())
        if infinite:
            return jsonify({"uses_remaining": "∞", "unlimited": True, "infinite": True, "message_count": message_count, "required_messages": AI_REQUIRED_MESSAGES, "ai_unlocked": True})
        return jsonify({"uses_remaining": max(0, AI_MAX_USES - used), "unlimited": False, "infinite": False, "message_count": message_count, "required_messages": AI_REQUIRED_MESSAGES, "ai_unlocked": message_count >= AI_REQUIRED_MESSAGES})
    except Exception as error:
        print("Supabase usage lookup failed:", repr(error))
        return jsonify({"error": "Could not check your AI usage."}), 500


@app.get("/api/chat/message-count")
def chat_message_count():
    try:
        visitor_id = ai_user_id()
        count = get_user_message_count(message_owner_id())
        _, infinite = get_ai_usage(visitor_id)
        return jsonify({"message_count": count, "required_messages": AI_REQUIRED_MESSAGES, "ai_unlocked": infinite or count >= AI_REQUIRED_MESSAGES, "infinite": infinite})
    except Exception as error:
        print("Message count lookup failed:", repr(error))
        return jsonify({"error": "Could not check your message count."}), 500


@app.get("/api/ai/history")
def ai_history():
    try:
        visitor_id = ai_user_id()
        return jsonify({"conversations": list_conversations(supabase, visitor_id)})
    except Exception as error:
        print("AI history lookup failed:", repr(error))
        return jsonify({"error": "Could not load AI chat history."}), 500
