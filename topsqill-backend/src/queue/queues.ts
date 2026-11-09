/**
 * Queue names, kept apart from the Nest queue module so the worker can import
 * them without loading the API's Redis module (which connects on import).
 */
export const QUEUES = {
  media: "media",          // image resizing, video to HLS, 3D compression, safety checks
  ai: "ai",                // listing extraction, captions, lead scoring
  fanout: "fanout",        // writing new posts into followers' feeds
  notify: "notify",        // push, WhatsApp, email
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
