import { Platform } from 'react-native';

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
 * The API wraps every response as `{ status, data }` via its transform
 * interceptor, so unwrapping lives here once instead of in every caller.
 */
async function request<T>(
  path: string,
  { token, ...init }: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(
      body?.message ?? body?.errors?.message ?? `Request failed (${res.status})`,
      res.status,
    );
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

export type AskResponse = {
  question: string;
  answer: string;
  sources: Array<{
    fileUuid: string;
    summary: string | null;
    similarity: number;
    createdAt: string;
  }>;
};

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; refreshToken: string }>('/auth/email/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
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

  submit: (token: string, fileUuid: string, rawText: string) =>
    request<VoiceNote>('/voice/processing', {
      method: 'POST',
      token,
      // The server runs in UTC and has no other way to know what "at 2:43"
      // means in wall-clock terms — without this, a spoken reminder time can
      // only be guessed at, or silently dropped.
      body: JSON.stringify({ fileUuid, rawText, timezone: deviceTimezone() }),
    }),

  deleteNote: (token: string, fileUuid: string) =>
    request<{ fileUuid: string }>(`/voice/${fileUuid}`, {
      method: 'DELETE',
      token,
    }),

  ask: (token: string, question: string) =>
    request<AskResponse>('/memory/ask', {
      method: 'POST',
      token,
      body: JSON.stringify({ question }),
    }),

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

  /** Is this a question to answer, or something to remember? Server-side, so one box serves both. */
  classify: (token: string, text: string) =>
    request<{ intent: 'ask' | 'remember' }>('/memory/classify', {
      method: 'POST',
      token,
      body: JSON.stringify({ text }),
    }),

  entities: (token: string, limit = 50) =>
    request<Entity[]>(`/memory/entities?limit=${limit}`, { token }),

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
 * Multipart, so it can't go through request() — that sets a JSON content-type.
 * Letting fetch set the boundary itself is required; setting Content-Type by
 * hand omits the boundary and the server can't parse the body.
 */
export async function transcribe(
  token: string,
  file: Blob | { uri: string; name: string; type: string },
  filename: string,
): Promise<{ text: string }> {
  const form = new FormData();
  if (file instanceof Blob) {
    form.append('file', file, filename);
  } else {
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
