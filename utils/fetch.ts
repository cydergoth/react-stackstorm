// Error used to return fetch errors so we can retry if required
export class FetchError extends Error {
  readonly res: Response;

  constructor(message: string, res: Response) {
    super(message);
    this.res = res;
    this.name = 'FetchError';
  }
}
