export type RepositoryErrorCode = 'forbidden' | 'invalid_response' | 'unavailable';

/** Normalised repository error so the UI can show "backend unavailable" states consistently. */
export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(message: string, cause?: unknown, code: RepositoryErrorCode = 'unavailable') {
    super(message, { cause });
    this.name = 'RepositoryError';
    this.code = code;
  }
}
