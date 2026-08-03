"use client";

import { useEffect, useState } from "react";
import ChatPanel from "./ChatPanel";
import MusicPanel from "./MusicPanel";

interface Config {
  chatEnabled: boolean;
  musicEnabled: boolean;
  speechEnabled: boolean;
}

export default function SonicApp() {
  const [tab, setTab] = useState<"chat" | "music">("chat");
  const [config, setConfig] = useState<Config>({ chatEnabled: true, musicEnabled: true, speechEnabled: true });
  const [loadedConfig, setLoadedConfig] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: Config) => setConfig(data))
      .catch(() => {})
      .finally(() => setLoadedConfig(true));
  }, []);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-8">
      <header className="mb-6 flex flex-col gap-2 text-center">
        <div className="mx-auto flex items-center gap-2">
          <span className="text-3xl">🎧</span>
          <h1 className="text-3xl font-bold text-white">SonicAI</h1>
        </div>
        <p className="text-sm text-slate-400">AI conversation and music discovery, powered by secure server-side APIs</p>
        {loadedConfig && (
          <div className="mx-auto flex flex-wrap justify-center gap-2 pt-1 text-xs">
            <StatusPill label="Chat" ok={config.chatEnabled} />
            <StatusPill label="Music" ok={config.musicEnabled} />
            <StatusPill label="Speech" ok={config.speechEnabled} />
          </div>
        )}
      </header>

      <div className="mx-auto mb-4 flex rounded-full border border-white/10 bg-white/5 p-1">
        <button
          onClick={() => setTab("chat")}
          className={`rounded-full px-5 py-2 text-sm font-medium transition ${
            tab === "chat" ? "bg-violet-500 text-white" : "text-slate-300 hover:text-white"
          }`}
        >
          💬 Chat
        </button>
        <button
          onClick={() => setTab("music")}
          className={`rounded-full px-5 py-2 text-sm font-medium transition ${
            tab === "music" ? "bg-teal-500 text-slate-950" : "text-slate-300 hover:text-white"
          }`}
        >
          🎵 Music
        </button>
      </div>

      <main className="min-h-[600px] flex-1 overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 shadow-[0_24px_60px_rgba(0,0,0,0.35)] backdrop-blur">
        <div className={tab === "chat" ? "h-[600px]" : "hidden"}>
          <ChatPanel chatEnabled={config.chatEnabled} />
        </div>
        <div className={tab === "music" ? "h-[600px]" : "hidden"}>
          <MusicPanel speechEnabled={config.speechEnabled} />
        </div>
      </main>

      <footer className="mt-6 text-center text-xs text-slate-500">
        The frontend never sees any API keys — all requests go through <code>/api/chat</code>,{" "}
        <code>/api/music</code>, and <code>/api/speech</code>.
      </footer>
    </div>
  );
}

function StatusPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${
        ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-amber-400/30 bg-amber-400/10 text-amber-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
      {label} {ok ? "ready" : "not configured"}
    </span>
  );
}
