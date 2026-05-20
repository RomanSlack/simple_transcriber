/** Tracks currently-active recording session IDs so shutdown / crash handlers
 *  can flush their write streams and leave the DB in a recoverable state. */
export const activeRecordings = new Set<string>();
