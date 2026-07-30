import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { api, type ConversationSummary, type VoiceNote } from './api';

/**
 * Server state lives here, not in useState.
 *
 * Everything below is data the API owns. It used to be hand-managed: each
 * screen fetched into its own useState, and keeping those copies current was
 * manual work that showed — the feed patched its own `notes` array from socket
 * payloads, and the sidebar was refreshed by incrementing a `graphVersion`
 * counter threaded down through two components purely to change a prop and
 * retrigger an effect.
 *
 * With a cache, "this data changed" is one call against a key, and every
 * screen reading that key updates itself. The socket's job shrinks from
 * "reproduce the server's mutation locally, in each place it is displayed" to
 * "say what became stale".
 */

/**
 * Keys are hierarchical so a prefix invalidates its children: invalidating
 * ['chats'] catches both the sidebar's ['chats', 4] and the chat list's
 * ['chats', 30], which is what you almost always mean.
 */
export const queryKeys = {
  notes: ['notes'] as const,
  entities: ['entities'] as const,
  entity: (id: number) => ['entity', id] as const,
  reminders: ['reminders'] as const,
  chats: (limit: number) => ['chats', limit] as const,
  chatsAll: ['chats'] as const,
  chat: (uuid: string) => ['chat', uuid] as const,
  graph: ['graph'] as const,
};

/**
 * Everything a finished note touches.
 *
 * A processed note writes a summary, new entities, new relations, and possibly
 * a reminder — so one `voice-processed` event makes four different views stale
 * at once. Naming them together keeps the socket handler from having to
 * remember the full blast radius, which is exactly the kind of thing that goes
 * out of date silently.
 */
export function invalidateAfterNoteProcessed(client: QueryClient) {
  void client.invalidateQueries({ queryKey: queryKeys.notes });
  void client.invalidateQueries({ queryKey: queryKeys.entities });
  void client.invalidateQueries({ queryKey: queryKeys.reminders });
  void client.invalidateQueries({ queryKey: queryKeys.graph });
}

export function useNotes(token: string | null, limit = 30) {
  return useQuery({
    queryKey: queryKeys.notes,
    queryFn: () => api.history(token!, limit),
    enabled: !!token,
  });
}

export function useEntities(token: string | null, limit = 50) {
  return useQuery({
    queryKey: queryKeys.entities,
    queryFn: () => api.entities(token!, limit),
    enabled: !!token,
  });
}

export function useEntityDetail(token: string | null, id: number | null) {
  return useQuery({
    queryKey: queryKeys.entity(id!),
    queryFn: () => api.entity(token!, id!),
    enabled: !!token && id != null,
  });
}

export function useReminders(token: string | null, limit = 20) {
  return useQuery({
    queryKey: queryKeys.reminders,
    queryFn: () => api.reminders(token!, limit),
    enabled: !!token,
  });
}

export function useChats(token: string | null, limit = 30) {
  return useQuery({
    queryKey: queryKeys.chats(limit),
    queryFn: () => api.chats(token!, limit),
    enabled: !!token,
  });
}

export function useChatHistory(token: string | null, uuid: string | null) {
  return useQuery({
    queryKey: queryKeys.chat(uuid!),
    queryFn: () => api.chat(token!, uuid!),
    enabled: !!token && !!uuid,
  });
}

export function useGraph(token: string | null, limit = 60) {
  return useQuery({
    queryKey: queryKeys.graph,
    queryFn: () => api.graph(token!, limit),
    enabled: !!token,
  });
}

/**
 * Deleting a conversation drops it from every chat list immediately.
 *
 * Both list sizes live under the ['chats'] prefix, so the optimistic write has
 * to touch each cached variant rather than one known key — the sidebar asks for
 * 4 and the chats screen for 30, and a delete that only fixed one would leave
 * the row visibly still there on the other screen.
 */
export function useDeleteChat(token: string | null) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (conversationUuid: string) =>
      api.deleteChat(token!, conversationUuid),

    onMutate: async (conversationUuid) => {
      await client.cancelQueries({ queryKey: queryKeys.chatsAll });
      const previous = client.getQueriesData<ConversationSummary[]>({
        queryKey: queryKeys.chatsAll,
      });
      client.setQueriesData<ConversationSummary[]>(
        { queryKey: queryKeys.chatsAll },
        (old) =>
          (old ?? []).filter((c) => c.conversationUuid !== conversationUuid),
      );
      return { previous };
    },

    onError: (_error, _uuid, context) => {
      for (const [key, data] of context?.previous ?? []) {
        client.setQueryData(key, data);
      }
    },

    onSuccess: (_data, conversationUuid) => {
      // The thread itself is gone; drop its cached turns so reopening the uuid
      // cannot render a conversation that no longer exists.
      client.removeQueries({ queryKey: queryKeys.chat(conversationUuid) });
    },
  });
}

/**
 * Deleting a note removes it from the feed immediately and puts it back if the
 * server refuses — the row vanishing on tap is the whole point, and waiting a
 * round-trip to find out makes the app feel like it is thinking about it.
 *
 * The server also detaches the note's mentions, so the entity counts and the
 * graph are stale afterwards, not just the feed.
 */
export function useDeleteNote(token: string | null) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (fileUuid: string) => api.deleteNote(token!, fileUuid),

    onMutate: async (fileUuid) => {
      // Stop any in-flight refetch from landing after the optimistic write and
      // resurrecting the row.
      await client.cancelQueries({ queryKey: queryKeys.notes });
      const previous = client.getQueryData<VoiceNote[]>(queryKeys.notes);
      client.setQueryData<VoiceNote[]>(queryKeys.notes, (old) =>
        (old ?? []).filter((n) => n.fileUuid !== fileUuid),
      );
      return { previous };
    },

    onError: (_error, _fileUuid, context) => {
      if (context?.previous) {
        client.setQueryData(queryKeys.notes, context.previous);
      }
    },

    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.entities });
      void client.invalidateQueries({ queryKey: queryKeys.graph });
    },
  });
}
