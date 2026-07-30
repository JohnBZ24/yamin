import { Platform } from 'react-native';
import { File } from 'expo-file-system';

/**
 * Reading a recording off the device, per platform.
 *
 * Extracted so the feed composer and the chat dictation button share one copy.
 * The native/web split below is subtle and was expensive to get right; two
 * near-identical versions of it would drift.
 */

/** The upload/transcribe path needs a real extension; the recorder tells us the container per platform. */
export function extensionFor(uri: string, blobType: string): string {
  if (Platform.OS !== 'web') {
    const match = /\.[A-Za-z0-9]+$/.exec(uri);
    return match ? match[0].toLowerCase() : '.m4a';
  }
  // Web recordings come out of MediaRecorder: webm/opus on Chrome, mp4 on Safari.
  if (blobType.includes('mp4') || blobType.includes('aac')) return '.m4a';
  if (blobType.includes('ogg')) return '.ogg';
  if (blobType.includes('mpeg')) return '.mp3';
  if (blobType.includes('wav')) return '.wav';
  return '.webm';
}

/**
 * Mirrors contentTypeFor() in the backend's VoiceService. On native the file's
 * own reported mime type is preferred; this is the fallback for when the OS
 * gives back an empty string, which is what made the multipart part arrive
 * type-less and unparseable.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
};

export function mimeForExtension(extension: string): string {
  return MIME_BY_EXTENSION[extension.toLowerCase()] ?? 'audio/mp4';
}

/**
 * The recording, in whatever form this platform can actually hand to the
 * network layer.
 *
 * This split exists because of a hard React Native limitation: RN's Blob cannot
 * be constructed from bytes, so `await (await fetch(fileUri)).blob()` — the web
 * idiom — throws "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' is
 * not supported" on a device. Every voice note failed there, before it was even
 * transcribed. Native reads the recording through expo-file-system instead, and
 * both the transcribe upload and the S3 PUT send its raw bytes.
 */
export type Recording =
  | { platform: 'web'; blob: Blob; extension: string; mimeType: string }
  | { platform: 'native'; file: File; extension: string; mimeType: string };

export async function readRecording(uri: string): Promise<Recording> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    const extension = extensionFor(uri, blob.type ?? '');
    return {
      platform: 'web',
      blob,
      extension,
      mimeType: blob.type || mimeForExtension(extension),
    };
  }

  const file = new File(uri);
  if (!file.exists || file.size <= 0) {
    throw new Error('Recording produced no audio');
  }
  const extension = extensionFor(uri, '');
  return {
    platform: 'native',
    file,
    extension,
    mimeType: file.type || mimeForExtension(extension),
  };
}

/**
 * The multipart part for a transcription upload.
 *
 * A hand-built part rather than the File itself: expo/fetch takes the multipart
 * filename from `.name`, and File.name is whatever the recorder happened to call
 * its temp file. The STT provider picks the decoder from that extension, so it
 * must be one we chose.
 */
export function transcribePart(recording: Recording, localName: string) {
  return recording.platform === 'web'
    ? recording.blob
    : {
        bytes: () => recording.file.bytes(),
        name: localName,
        type: recording.mimeType,
      };
}
