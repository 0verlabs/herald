export const MAX_ATTACHMENTS = 10;

/** `data:<mime>;base64,<payload>` — captures the mime type and the payload. */
export const DATA_URL_PATTERN = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/;
