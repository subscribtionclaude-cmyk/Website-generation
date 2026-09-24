/** Normalised repository error so the UI can show "backend unavailable" states consistently. */
export class RepositoryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'RepositoryError';
  }
}
