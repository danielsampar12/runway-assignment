export type Result<T, E = string> =
  | { success: true; data: T }
  | { success: false; error: E; status: number };

export function ok(): Result<void, never>;
export function ok<T>(data: T): Result<T, never>;
export function ok<T>(data?: T): Result<T | void, never> {
  return { success: true, data };
}

export function fail<E>(error: E, status: number): Result<never, E> {
  return { success: false, error, status };
}

export const badRequest = <E>(e: E) => fail(e, 400);
export const unauthorized = <E>(e: E) => fail(e, 401);
export const forbidden = <E>(e: E) => fail(e, 403);
export const notFound = <E>(e: E) => fail(e, 404);
export const conflict = <E>(e: E) => fail(e, 409);
