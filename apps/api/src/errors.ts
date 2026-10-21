export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = 'error',
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}
