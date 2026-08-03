// Public, non-secret configuration for the frontend. This route NEVER
// returns the actual value of GROQ_API_KEY or AUDIUS_API_KEY — only whether
// each integration is configured, so the UI can show helpful status states.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    chatEnabled: Boolean(process.env.GROQ_API_KEY),
    speechEnabled: Boolean(process.env.GROQ_API_KEY),
    // Audius search works without a key (an API key only raises rate limits),
    // so music search is always considered available.
    musicEnabled: true,
  });
}
