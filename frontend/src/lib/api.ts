import { fetch as streamingFetch } from 'expo/fetch';
import { Platform } from 'react-native';

import { getSession, setSession } from './session-store';

/**
 * Android emulators can't reach the host's localhost — 10.0.2.2 is the loopback
 * alias. A physical device needs the machine's LAN IP, which is what
 * EXPO_PUBLIC_API_URL is for.
 */
const DEFAULT_HOST =
  Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

// `||`, not `??`: EXPO_PUBLIC_* vars are inlined at export time, and an unset
// build arg inlines an empty STRING rather than undefined. `??` would keep that
// empty value and silently make every request relative to the web origin,
// pointing the app at itself instead of the API.
export const API_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_HOST;
const BASE = `${API_URL}/api/v1`;

/** Best-effort IANA zone (e.g. "Asia/Beirut"); undefined lets the server fall back to its own default. */
function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * One refresh at a time: every 401 that lands while a refresh is in flight
 * awaits the same promise instead of burning the refresh token twice (the
 * second attempt would fail and sign the user out for no reason).
 */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const session = getSession();
      if (!session?.refreshToken) return null;
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        });
        if (!res.ok) throw new Error(`refresh failed (${res.status})`);
        const body = await res.json();
        const data = body?.data ?? body;
        await setSession({ token: data.token, refreshToken: data.refreshToken });
        return data.token as string;
      } catch {
        // Refresh token expired or revoked — the session is over. Clearing it
        // is what routes the user back to the login screen.
        await setSession(null);
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/**
 * Turn an error body into something worth showing a human.
 *
 * The API has two error shapes. Business errors carry a top-level `message`
 * ("The email provided is already in use."). Validation failures instead carry
 * a per-field map: `{status: 422, errors: {password: "password must be longer
 * than or equal to 6 characters"}}` — no `message` anywhere. Reading only
 * `.message` left every validation failure showing as the bare, unactionable
 * "Request failed (422)", which is exactly what a signup with a 5-character
 * password looked like: a dead end with the real reason sitting unread in the
 * payload.
 */
function explainError(body: any, status: number): string {
  if (typeof body?.message === 'string') return body.message;

  const fieldErrors = body?.errors;
  if (fieldErrors && typeof fieldErrors === 'object') {
    if (typeof fieldErrors.message === 'string') return fieldErrors.message;
    const messages = Object.values(fieldErrors).filter(
      (v): v is string => typeof v === 'string',
    );
    if (messages.length) {
      // Sentence-case each: the validators emit "password must be longer…".
      return messages
        .map((m) => m.charAt(0).toUpperCase() + m.slice(1))
        .join('\n');
    }
  }

  return `Request failed (${status})`;
}

/**
 * The API wraps every response as `{ status, data }` via its transform
 * interceptor, so unwrapping lives here once instead of in every caller.
 *
 * On a 401 with a stored session, this refreshes once and retries — an
 * expired access token used to surface as a raw error with no way back but
 * killing the app.
 */
async function request<T>(
  path: string,
  { token, ...init }: RequestInit & { token?: string | null } = {},
  isRetry = false,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401 && token && !isRetry && !path.startsWith('/auth/')) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      return request<T>(path, { token: fresh, ...init }, true);
    }
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(explainError(body, res.status), res.status);
  }

  return (body?.data ?? body) as T;
}

export type VoiceNote = {
  id?: number;
  fileUuid: string;
  audioUrl: string | null;
  rawText: string | null;
  status: 'pending' | 'processed' | 'failed' | string;
  summary: string | null;
  createdAt: string;
  /**
   * Amplitude envelope of the recording, 0–100 per bar, captured on the device
   * from expo-audio metering. Null/absent for typed notes and for anything
   * recorded before this shipped — the player falls back to a flat shape.
   */
  peaks?: number[] | null;
  /**
   * Whether the note actually went into the memory.
   *
   * Separate from `status` on purpose: a note is `processed` whether or not
   * anything about it was worth keeping. The extractor judges that, and a note
   * with nothing about your life in it ("hello") is stored without an embedding,
   * which means search can never return it. Absent on optimistic rows that have
   * not been through the server yet.
   */
  remembered?: boolean;
  nodes?: GraphNode[];
  relations?: unknown[];
};

export type GraphNode = { id?: number; type: string; name: string; description?: string };

export type Entity = {
  id: number;
  type: string;
  name: string;
  description: string | null;
  mentionCount: number;
  lastMentionedAt: string | null;
};

export type AskSource = {
  fileUuid: string;
  summary: string | null;
  similarity: number;
  createdAt: string;
};

export type AskResponse = {
  conversationUuid: string;
  question: string;
  answer: string;
  sources: AskSource[];
};

/**
 * How the server routes one message. `chitchat` is the lane for anything aimed
 * at Yamin itself ("what can you do?") or general advice — without it those
 * questions were filed as notes.
 */
export type Intent = 'ask' | 'remember' | 'chitchat';

export type ConverseResponse = AskResponse & {
  /** answer = grounded in memories; remembered = stored (and any reminder scheduled); chat = small talk. */
  kind: 'answer' | 'remembered' | 'chat';
};

export type ConverseStreamMeta = {
  conversationUuid: string;
  kind: ConverseResponse['kind'];
  sources: AskSource[];
};

/**
 * The streaming half of converse. Metadata arrives first (from response
 * headers), then the Markdown answer in chunks as the model generates it.
 * Uses expo/fetch — the global RN fetch cannot stream response bodies.
 */
async function converseStreamOnce(
  token: string,
  body: { message: string; conversationUuid?: string },
  onMeta: (meta: ConverseStreamMeta) => void,
  onChunk: (text: string) => void,
): Promise<void> {
  const res = await streamingFetch(`${BASE}/memory/converse/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ...body, timezone: deviceTimezone() }),
  });

  if (!res.ok || !res.body) {
    throw new ApiError(`Request failed (${res.status})`, res.status);
  }

  const rawSources = res.headers.get('x-sources');
  onMeta({
    conversationUuid: res.headers.get('x-conversation-uuid') ?? '',
    kind: (res.headers.get('x-kind') as ConverseResponse['kind']) ?? 'answer',
    sources: rawSources
      ? (JSON.parse(decodeURIComponent(rawSources)) as AskSource[])
      : [],
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) onChunk(decoder.decode(value, { stream: true }));
  }
}

export type ConversationSummary = {
  conversationUuid: string;
  title: string;
  turnCount: number;
  lastAt: string;
};

export type ChatTurnRecord = {
  question: string;
  answer: string;
  sources: AskSource[];
  createdAt: string;
};

/**
 * A reminder Yamin scheduled. `sent` ones are its own history — the record that
 * used to vanish with the queue job, which is why it could never answer "what
 * did you remind me about?".
 */
export type Reminder = {
  id: number;
  title: string;
  scheduledFor: string;
  timezone: string | null;
  status: 'scheduled' | 'sent' | 'failed';
  deliveredDeviceCount: number;
  sentAt: string | null;
};

export type GraphData = {
  nodes: Entity[];
  edges: Array<{
    id: number;
    sourceNodeId: number;
    targetNodeId: number;
    type: string;
    description: string | null;
    mentionCount: number;
  }>;
};

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; refreshToken: string }>('/auth/email/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (details: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) =>
    request<{ token: string; refreshToken: string }>('/auth/email/register', {
      method: 'POST',
      body: JSON.stringify(details),
    }),

  history: (token: string, limit = 30) =>
    request<VoiceNote[]>(`/voice/history?page=1&limit=${limit}`, { token }),

  presign: (token: string, fileExtension: string) =>
    request<{
      fileUuid: string;
      uploadUrl: string;
      downloadUrl: string;
      contentType: string;
    }>('/voice/presigned-url', {
      method: 'POST',
      token,
      body: JSON.stringify({ fileExtension }),
    }),

  submit: (token: string, fileUuid: string, rawText: string, peaks?: number[]) =>
    request<VoiceNote>('/voice/processing', {
      method: 'POST',
      token,
      // The server runs in UTC and has no other way to know what "at 2:43"
      // means in wall-clock terms — without this, a spoken reminder time can
      // only be guessed at, or silently dropped.
      //
      // `peaks` is omitted rather than sent as undefined for a typed note: the
      // DTO validates it when present, and an explicit null would clear an
      // envelope already stored against this uuid.
      body: JSON.stringify({
        fileUuid,
        rawText,
        timezone: deviceTimezone(),
        ...(peaks?.length ? { peaks } : {}),
      }),
    }),

  deleteNote: (token: string, fileUuid: string) =>
    request<{ fileUuid: string }>(`/voice/${fileUuid}`, {
      method: 'DELETE',
      token,
    }),

  ask: (token: string, question: string, conversationUuid?: string) =>
    request<AskResponse>('/memory/ask', {
      method: 'POST',
      token,
      body: JSON.stringify({ question, conversationUuid }),
    }),

  /**
   * The secretary chat: the server classifies the message and either answers
   * from memory, remembers it (running the full voice-note pipeline, reminders
   * included), or just chats back. Timezone rides along so "remind me at 5"
   * resolves against the user's clock.
   */
  converse: (token: string, message: string, conversationUuid?: string) =>
    request<ConverseResponse>('/memory/converse', {
      method: 'POST',
      token,
      body: JSON.stringify({ message, conversationUuid, timezone: deviceTimezone() }),
    }),

  /** converse, but the answer streams in as it is generated. One 401 retry after a token refresh, same as request(). */
  converseStream: async (
    token: string,
    body: { message: string; conversationUuid?: string },
    onMeta: (meta: ConverseStreamMeta) => void,
    onChunk: (text: string) => void,
  ): Promise<void> => {
    try {
      await converseStreamOnce(token, body, onMeta, onChunk);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        const fresh = await refreshAccessToken();
        if (fresh) {
          return converseStreamOnce(fresh, body, onMeta, onChunk);
        }
      }
      throw error;
    }
  },

  chats: (token: string, limit = 30) =>
    request<ConversationSummary[]>(`/memory/chats?limit=${limit}`, { token }),

  chat: (token: string, conversationUuid: string) =>
    request<ChatTurnRecord[]>(`/memory/chats/${conversationUuid}`, { token }),

  /**
   * Removes the transcript only. Notes the conversation remembered, entities it
   * created and reminders it set are kept — deleting a chat tidies the list, it
   * does not erase what Yamin learned.
   */
  deleteChat: (token: string, conversationUuid: string) =>
    request<{ conversationUuid: string; deletedTurns: number }>(
      `/memory/chats/${conversationUuid}`,
      { method: 'DELETE', token },
    ),

  /**
   * Registers this device for reminder notifications. Without it a reminder
   * only arrives while the app is open with a live socket.
   */
  registerPushToken: (token: string, pushToken: string, platform: string) =>
    request<{ registered: boolean }>('/push/token', {
      method: 'POST',
      token,
      body: JSON.stringify({ token: pushToken, platform }),
    }),

  /**
   * A question to answer, something to remember, or something to just reply to?
   * Server-side, so one box serves all three.
   */
  classify: (token: string, text: string) =>
    request<{ intent: Intent }>('/memory/classify', {
      method: 'POST',
      token,
      body: JSON.stringify({ text }),
    }),

  /**
   * The chitchat lane: greetings, "what can you do?", general advice. Returns
   * the same shape as ask() with an empty `sources`, which is what tells the UI
   * to label the answer as general rather than drawn from the user's memories.
   */
  reply: (token: string, message: string, conversationUuid?: string) =>
    request<AskResponse>('/memory/reply', {
      method: 'POST',
      token,
      body: JSON.stringify({ message, conversationUuid }),
    }),

  entities: (token: string, limit = 50) =>
    request<Entity[]>(`/memory/entities?limit=${limit}`, { token }),

  /** Upcoming reminders first, then ones already sent. */
  reminders: (token: string, limit = 20) =>
    request<Reminder[]>(`/memory/reminders?limit=${limit}`, { token }),

  /** Top entities plus every relation among them, in one round-trip. */
  graph: (token: string, limit = 60) =>
    request<GraphData>(`/memory/graph?limit=${limit}`, { token }),

  entity: (token: string, id: number) =>
    request<{
      entity: Entity;
      facts: Array<{
        type: string;
        direction: 'outgoing' | 'incoming';
        otherNodeName: string;
        otherNodeType: string;
        mentionCount: number;
      }>;
      mentions: Array<{ summary: string | null; createdAt: string }>;
    }>(`/memory/entities/${id}`, { token }),
};

/**
 * A file part this app can actually send.
 *
 * On native it is NOT React Native's classic `{uri, name, type}` shape. Expo
 * SDK 57 replaces the global `fetch` with expo/fetch, whose multipart encoder
 * states outright that "`uri` is not supported for React Native's FormData" —
 * it accepts a string, a real Blob, or any object exposing `bytes()`, and reads
 * `.name`/`.type` for the part headers. Passing the classic shape throws
 * "Unsupported FormDataPart implementation" and no audio ever leaves the phone.
 */
export type UploadPart = {
  bytes: () => Promise<Uint8Array>;
  name: string;
  type: string;
};

/**
 * Multipart, so it can't go through request() — that sets a JSON content-type.
 * Letting fetch set the boundary itself is required; setting Content-Type by
 * hand omits the boundary and the server can't parse the body.
 */
export async function transcribe(
  token: string,
  file: Blob | UploadPart,
  filename: string,
): Promise<{ text: string }> {
  const form = new FormData();
  if (file instanceof Blob) {
    // Web: the browser's own FormData, where the third argument sets the filename.
    form.append('file', file, filename);
  } else {
    // Native: expo/fetch reads the filename off `.name`, not off a third
    // argument, which is why the part carries its own name.
    form.append('file', file as unknown as Blob);
  }

  const res = await fetch(`${BASE}/voice/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const body = await res.json();
  if (!res.ok) {
    throw new ApiError(body?.message ?? 'Transcription failed', res.status);
  }
  return body?.data ?? body;
}
