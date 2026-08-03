import { pgTable, serial, text, timestamp, varchar, index } from "drizzle-orm/pg-core";

// Stores chat conversation memory so /api/chat can recall prior turns for a
// given session without ever exposing provider API keys to the client.
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    sessionId: varchar("session_id", { length: 64 }).notNull(),
    role: varchar("role", { length: 16 }).notNull(), // "system" | "user" | "assistant"
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("chat_messages_session_id_idx").on(table.sessionId, table.createdAt)],
);
