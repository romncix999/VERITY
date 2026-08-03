import { NextRequest } from "next/server";

// This route never exposes GROQ_API_KEY to the client. It only ever runs
// server-side. The frontend only ever talks to `/api/speech`.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_SPEECH_URL = "https://api.groq.com/openai/v1/audio/speech";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
const TTS_MODEL = "playai-tts";
const DEFAULT_VOICE = "Fritz-PlayAI";
const MAX_TEXT_LENGTH = 2000;

/**
 * POST /api/speech
 *  - multipart/form-data with an `audio` file  -> speech-to-text (transcription)
 *  - application/json { text, voice? }         -> text-to-speech (synthesis)
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Server is missing GROQ_API_KEY. Add it in your Vercel project's Environment Variables." },
      { status: 500 },
    );
  }

  const contentType = req.headers.get("content-type") || "";

  try {
    if (contentType.includes("multipart/form-data")) {
      return await handleTranscription(req, apiKey);
    }
    return await handleSynthesis(req, apiKey);
  } catch (err) {
    console.error("[/api/speech] unexpected error:", err);
    return Response.json({ error: "Unexpected error handling speech request." }, { status: 500 });
  }
}

async function handleTranscription(req: NextRequest, apiKey: string) {
  const incoming = await req.formData();
  const audio = incoming.get("audio");

  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json({ error: "An `audio` file is required." }, { status: 400 });
  }
  if (audio.size > 20 * 1024 * 1024) {
    return Response.json({ error: "Audio file is too large (max 20MB)." }, { status: 400 });
  }

  const forward = new FormData();
  forward.append("file", audio, "speech.webm");
  forward.append("model", TRANSCRIBE_MODEL);
  forward.append("response_format", "json");

  let upstream: Response;
  try {
    upstream = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: forward,
    });
  } catch (err) {
    console.error("[/api/speech] network error contacting Groq (transcription):", err);
    return Response.json({ error: "Could not reach the speech provider. Please try again." }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error("[/api/speech] transcription error:", upstream.status, detail);
    return Response.json({ error: "Speech-to-text request failed." }, { status: 502 });
  }

  const json = await upstream.json();
  return Response.json({ text: typeof json?.text === "string" ? json.text : "" });
}

async function handleSynthesis(req: NextRequest, apiKey: string) {
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return Response.json({ error: "`text` is required." }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return Response.json({ error: `Text is too long (max ${MAX_TEXT_LENGTH} characters).` }, { status: 400 });
  }

  const voice = typeof body?.voice === "string" && body.voice.length > 0 ? body.voice : DEFAULT_VOICE;

  let upstream: Response;
  try {
    upstream = await fetch(GROQ_SPEECH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: TTS_MODEL, input: text, voice, response_format: "wav" }),
    });
  } catch (err) {
    console.error("[/api/speech] network error contacting Groq (speech):", err);
    return Response.json({ error: "Could not reach the speech provider. Please try again." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("[/api/speech] synthesis error:", upstream.status, detail);
    return Response.json({ error: "Text-to-speech request failed." }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
    },
  });
}
