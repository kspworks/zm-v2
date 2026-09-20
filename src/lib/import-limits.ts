/** 4 MB, measured on the decoded file */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/**
 * The gzipped upload. CSV text compresses ~6x, so this clears a 4 MB export
 * with room to spare while keeping the base64 body under the 4.5 MB request
 * cap serverless hosts impose.
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
