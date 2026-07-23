/**
 * The socket.io room every one of a user's connections joins.
 *
 * Rooms replace the old in-process `Map<userId, socketId[]>`. That map only
 * ever saw sockets belonging to *its own* process, so once the worker was a
 * separate instance its map was permanently empty and every notification it
 * "sent" was dropped on the floor. Rooms live in Redis via the adapter, so any
 * process can address a user without knowing where their socket is connected.
 */
export const userRoom = (userId: number): string => `user:${userId}`;

export const REALTIME_NOTIFIER = Symbol('REALTIME_NOTIFIER');

export interface RealtimeNotifier {
  sendToUser(userId: number, event: string, payload: unknown): Promise<void>;
}
