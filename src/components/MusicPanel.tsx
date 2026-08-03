"use client";

import { useRef, useState } from "react";

interface Song {
  id: string;
  title: string;
  artist: string;
  genre: string | null;
  durationSeconds: number;
  artwork: string | null;
  streamUrl: string;
}

function formatDuration(seconds: number) {
  if (!seconds) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MusicPanel({ speechEnabled }: { speechEnabled: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  async function search(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setIsSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/music?q=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Search failed.");
      setResults(data.results ?? []);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Could not search for music.");
    } finally {
      setIsSearching(false);
    }
  }

  function playSong(song: Song) {
    if (!audioRef.current) return;
    if (playingId === song.id) {
      audioRef.current.pause();
      setPlayingId(null);
      return;
    }
    audioRef.current.src = song.streamUrl;
    audioRef.current.play().catch(() => setError("Playback failed for this track."));
    setPlayingId(song.id);
  }

  async function speakSong(song: Song) {
    if (!speechEnabled || speakingId) return;
    setSpeakingId(song.id);
    setError(null);
    try {
      const res = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `${song.title}, by ${song.artist}` }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Text-to-speech failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (ttsAudioRef.current) {
        ttsAudioRef.current.src = url;
        await ttsAudioRef.current.play();
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Could not read the song aloud.");
    } finally {
      setSpeakingId(null);
    }
  }

  async function toggleVoiceSearch() {
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
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size === 0) return;
        try {
          const form = new FormData();
          form.append("audio", blob, "voice.webm");
          const res = await fetch("/api/speech", { method: "POST", body: form });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || "Transcription failed.");
          if (data.text) {
            setQuery(data.text);
            search(data.text);
          }
        } catch (err) {
          console.error(err);
          setError(err instanceof Error ? err.message : "Could not transcribe audio.");
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
      <div className="border-b border-white/10 px-5 py-4">
        <h2 className="text-lg font-semibold text-white">Music Discovery</h2>
        <p className="text-xs text-slate-400">Powered by Audius · search, stream, and listen</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
        className="flex items-center gap-2 px-5 pt-4"
      >
        <button
          type="button"
          onClick={toggleVoiceSearch}
          disabled={!speechEnabled}
          title="Voice search"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition disabled:opacity-40 ${
            isRecording
              ? "border-red-400 bg-red-500/20 text-red-300 animate-pulse"
              : "border-white/10 text-slate-300 hover:bg-white/10"
          }`}
        >
          🎤
        </button>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs, artists, genres…"
          className="flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-teal-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isSearching || !query.trim()}
          className="rounded-full bg-teal-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-teal-400 disabled:opacity-40"
        >
          {isSearching ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <div className="mx-5 mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
        {results.length === 0 && !isSearching && (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">
            Try searching for “lofi”, “synthwave”, or your favorite artist.
          </div>
        )}
        {results.map((song) => (
          <div
            key={song.id}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:bg-white/10"
          >
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-800">
              {song.artwork ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={song.artwork} alt={song.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-lg">🎵</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{song.title}</p>
              <p className="truncate text-xs text-slate-400">
                {song.artist} {song.genre ? `· ${song.genre}` : ""}
              </p>
            </div>
            <span className="shrink-0 text-xs text-slate-500">{formatDuration(song.durationSeconds)}</span>
            <button
              onClick={() => playSong(song)}
              className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10"
            >
              {playingId === song.id ? "⏸ Pause" : "▶ Play"}
            </button>
            <button
              onClick={() => speakSong(song)}
              disabled={!speechEnabled || speakingId === song.id}
              title="Read title aloud"
              className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
            >
              {speakingId === song.id ? "…" : "🔊"}
            </button>
          </div>
        ))}
      </div>

      <audio ref={audioRef} onEnded={() => setPlayingId(null)} className="hidden" />
      <audio ref={ttsAudioRef} className="hidden" />
    </div>
  );
}
