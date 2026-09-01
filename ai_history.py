from supabase import Client
import threading
import time
import sys


def list_conversations(supabase: Client, visitor_hash: str):
    result = supabase.rpc("list_ai_conversations", {"p_visitor_hash": visitor_hash}).execute()
    return result.data or []


def get_messages(supabase: Client, visitor_hash: str, conversation_id: str):
    result = supabase.rpc(
        "get_ai_conversation",
        {"p_visitor_hash": visitor_hash, "p_conversation_id": conversation_id},
    ).execute()
    return result.data or []


def create_conversation(supabase: Client, visitor_hash: str, title: str = "New Chat"):
    result = supabase.rpc(
        "create_ai_conversation",
        {"p_visitor_hash": visitor_hash, "p_title": title},
    ).execute()
    return str(result.data)


def save_message(supabase: Client, visitor_hash: str, conversation_id: str, role: str, content: str):
    result = supabase.rpc(
        "save_ai_message",
        {
            "p_visitor_hash": visitor_hash,
            "p_conversation_id": conversation_id,
            "p_role": role,
            "p_content": content,
        },
    ).execute()
    return result.data


def rename_conversation(supabase: Client, visitor_hash: str, conversation_id: str, title: str):
    result = supabase.rpc(
        "rename_ai_conversation",
        {
            "p_visitor_hash": visitor_hash,
            "p_conversation_id": conversation_id,
            "p_title": title,
        },
    ).execute()
    return bool(result.data)


def delete_conversation(supabase: Client, visitor_hash: str, conversation_id: str):
    result = supabase.rpc(
        "delete_ai_conversation",
        {
            "p_visitor_hash": visitor_hash,
            "p_conversation_id": conversation_id,
        },
    ).execute()
    return bool(result.data)


# The chat server imports this helper before it creates its Flask app/socket.
# Register the optional live features once the server module has finished loading.
def _register_late_features():
    for _ in range(100):
        server = sys.modules.get("server")
        if server is not None and hasattr(server, "app") and hasattr(server, "socketio") and hasattr(server, "supabase") and hasattr(server, "ai_user_id"):
            try:
                from enhancements import register_enhancements
                register_enhancements(server.app, server.socketio, server.supabase, server.ai_user_id)
            except Exception as error:
                print("Optional enhancements registration failed:", repr(error))
            return
        time.sleep(0.05)


threading.Thread(target=_register_late_features, daemon=True).start()
