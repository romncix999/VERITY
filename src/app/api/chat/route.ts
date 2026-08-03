import { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages } from "@/db/schema";

// This route never exposes GROQ_API_KEY to the client. It only ever runs
// server-side (Next.js Route Handler / Vercel Serverless Function) and the
// frontend only ever talks to `/api/chat`.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";
const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 4000;
const SYSTEM_PROMPT =
  "You are SonicAI, a warm and knowledgeable assistant embedded in a music discovery app. " +
  "Keep replies concise, friendly, and helpful. When relevant, suggest genres, artists, or moods " +
  "the user could search for in the Music tab.";

function randomSessionId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Server is missing GROQ_API_KEY. Add it in your Vercel project's Environment Variables." },
      { status: 500 },
    );
  }

  let body: { sessionId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return Response.json({ error: "`message` is required." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return Response.json(
      { error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).` },
      { status: 400 },
    );
  }

  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.length > 0 && body.sessionId.length <= 64
      ? body.sessionId
      : randomSessionId();

  // Conversation memory: pull prior turns for this session from Postgres.
  let history: { role: string; content: string }[] = [];
  try {
    history = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.createdAt))
      .limit(MAX_HISTORY_MESSAGES);
  } catch (err) {
    console.error("[/api/chat] failed to load conversation memory:", err);
  }

  try {
    await db.insert(chatMessages).values({ sessionId, role: "user", content: message });
  } catch (err) {
    console.error("[/api/chat] failed to persist user message:", err);
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  let upstream: Response;
  try {
    upstream = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });
  } catch (err) {
    console.error("[/api/chat] network error contacting Groq:", err);
    return Response.json({ error: "Could not reach the AI provider. Please try again." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    let detail = "";
    try {
      const errJson = await upstream.json();
      detail = errJson?.error?.message ?? "";
    } catch {
      // ignore parse failure, fall back to generic message below
    }
    console.error("[/api/chat] Groq API error:", upstream.status, detail);
    return Response.json(
      { error: detail || `AI provider responded with status ${upstream.status}.` },
      { status: upstream.status === 401 || upstream.status === 403 ? 500 : 502 },
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";
      let full = "";
      let closed = false;

      const send = (payload: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      send({ sessionId });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta: string | undefined = json?.choices?.[0]?.delta?.content;
              if (delta) {
                full += delta;
                send({ content: delta });
              }
            } catch {
              // ignore malformed SSE chunk
            }
          }
        }
      } catch (err) {
        console.error("[/api/chat] stream read error:", err);
        send({ error: "The response was interrupted. Please try again." });
      }

      if (full.trim()) {
        try {
          await db.insert(chatMessages).values({ sessionId, role: "assistant", content: full });
        } catch (err) {
          console.error("[/api/chat] failed to persist assistant message:", err);
        }
      }

      send({ done: true });
      closed = true;
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// Lets the client start a fresh conversation by clearing stored memory.
export async function DELETE(req: NextRequest) {
  try {
    const sessionId = new URL(req.url).searchParams.get("sessionId");
    if (!sessionId) {
      return Response.json({ error: "`sessionId` query param is required." }, { status: 400 });
    }
    await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[/api/chat] failed to clear conversation memory:", err);
    return Response.json({ error: "Failed to clear conversation." }, { status: 500 });
  }
}
