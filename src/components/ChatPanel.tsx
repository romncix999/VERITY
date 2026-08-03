"use client";

import { useEffect, useRef, useState } from "react";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

const SESSION_STORAGE_KEY = "sonicai.chat.sessionId";

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;
  const fresh =
    typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `sess_${Date.now()}_${Math.random()}`;
  window.localStorage.setItem(SESSION_STORAGE_KEY, fresh);
  return fresh;
}

export default function ChatPanel({ chatEnabled }: { chatEnabled: boolean }) {
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    setError(null);
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setIsStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: trimmed }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Request failed with status ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const json = JSON.parse(payload);
            if (json.sessionId && json.sessionId !== sessionId) {
              setSessionId(json.sessionId);
              window.localStorage.setItem(SESSION_STORAGE_KEY, json.sessionId);
            }
            if (json.content) {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + json.content } : m)),
              );
            }
            if (json.error) {
              setError(json.error);
            }
          } catch {
            // ignore malformed chunk
          }
        }
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.content));
    } finally {
      setIsStreaming(false);
    }
  }

  async function clearConversation() {
    try {
      await fetch(`/api/chat?sessionId=${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    } catch {
      // best-effort
    }
    setMessages([]);
  }

  async function toggleRecording() {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size === 0) return;

        setIsTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "voice.webm");
          const res = await fetch("/api/speech", { method: "POST", body: form });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || "Transcription failed.");
          if (data.text) {
            setInput((prev) => (prev ? `${prev} ${data.text}` : data.text));
          }
        } catch (err) {
          console.error(err);
          setError(err instanceof Error ? err.message : "Could not transcribe audio.");
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      setError("Microphone access was denied or is unavailable.");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-white">AI Chat</h2>
          <p className="text-xs text-slate-400">Powered by Groq · streamed in real time</p>
        </div>
        <button
          onClick={clearConversation}
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
        >
          New conversation
        </button>
      </div>

      {!chatEnabled && (
        <div className="mx-5 mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          Chat is not configured yet. Set <code className="font-mono">GROQ_API_KEY</code> in your Vercel
          environment variables.
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {messages.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">
            Ask for a mood, a genre, or just say hi — I can help you find something to listen to.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-violet-500 text-white"
                  : "bg-white/5 text-slate-100 border border-white/10"
              }`}
            >
              {m.content || (isStreaming ? "…" : "")}
            </div>
          </div>
        ))}
      </div>

      {error && <div className="mx-5 mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
        className="flex items-center gap-2 border-t border-white/10 px-5 py-4"
      >
        <button
          type="button"
          onClick={toggleRecording}
          disabled={!chatEnabled || isTranscribing}
          title="Voice input"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition disabled:opacity-40 ${
            isRecording
              ? "border-red-400 bg-red-500/20 text-red-300 animate-pulse"
              : "border-white/10 text-slate-300 hover:bg-white/10"
          }`}
        >
          {isTranscribing ? "…" : "🎤"}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={chatEnabled ? "Message SonicAI…" : "Chat unavailable"}
          disabled={!chatEnabled || isStreaming}
          className="flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-violet-400 focus:outline-none disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={!chatEnabled || isStreaming || !input.trim()}
          className="rounded-full bg-violet-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:opacity-40"
        >
          {isStreaming ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}
