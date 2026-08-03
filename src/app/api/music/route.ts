import { NextRequest } from "next/server";

// This route never exposes AUDIUS_API_KEY to the client. It only ever runs
// server-side. The frontend only ever talks to `/api/music`.
export const dynamic = "force-dynamic";

const DISCOVERY_BASE = "https://api.audius.co/v1";
const APP_NAME = "SonicAI";
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 25;

interface AudiusTrack {
  id: string;
  title: string;
  duration?: number;
  genre?: string | null;
  release_date?: string | null;
  artwork?: {
    "150x150"?: string;
    "480x480"?: string;
    "1000x1000"?: string;
  } | null;
  user?: {
    name?: string;
    handle?: string;
    is_verified?: boolean;
  } | null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q")?.trim();
  const rawLimit = Number(searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  if (!query) {
    return Response.json({ error: "Query param `q` is required, e.g. /api/music?q=lofi" }, { status: 400 });
  }

  const url = new URL(`${DISCOVERY_BASE}/tracks/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("app_name", APP_NAME);
  url.searchParams.set("limit", String(limit));

  const apiKey = process.env.AUDIUS_API_KEY;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const upstream = await fetch(url.toString(), { headers, cache: "no-store" });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      console.error("[/api/music] Audius API error:", upstream.status, text);
      return Response.json(
        { error: `Music provider responded with status ${upstream.status}.` },
        { status: 502 },
      );
    }

    const json = (await upstream.json()) as { data?: AudiusTrack[] };
    const tracks = json.data ?? [];

    const results = tracks.map((track) => ({
      id: track.id,
      title: track.title || "Untitled",
      artist: track.user?.name || track.user?.handle || "Unknown artist",
      artistHandle: track.user?.handle ?? null,
      verifiedArtist: Boolean(track.user?.is_verified),
      genre: track.genre ?? null,
      durationSeconds: track.duration ?? 0,
      releaseDate: track.release_date ?? null,
      artwork:
        track.artwork?.["480x480"] ??
        track.artwork?.["1000x1000"] ??
        track.artwork?.["150x150"] ??
        null,
      streamUrl: `${DISCOVERY_BASE}/tracks/${track.id}/stream?app_name=${encodeURIComponent(APP_NAME)}`,
    }));

    return Response.json({ query, count: results.length, results });
  } catch (err) {
    console.error("[/api/music] network error contacting Audius:", err);
    return Response.json(
      { error: "Could not reach the music provider. Please try again." },
      { status: 502 },
    );
  }
}
