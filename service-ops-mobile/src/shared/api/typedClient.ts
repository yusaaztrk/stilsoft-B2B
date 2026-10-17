import { apiJson } from './client';
import type { paths } from './openapi';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type PathItem<P extends keyof paths> = paths[P];

type Operation<P extends keyof paths, M extends HttpMethod> = PathItem<P> extends Record<string, any>
  ? M extends keyof PathItem<P>
    ? PathItem<P>[M]
    : never
  : never;

type ResponsesOf<Op> = Op extends { responses: infer R } ? R : never;

type ResponseContentOf<R> = R extends { content: infer C }
  ? C extends Record<string, any>
    ? C[keyof C]
    : never
  : never;

type SuccessResponse<R> =
  | (R extends Record<200, infer R200> ? ResponseContentOf<R200> : never)
  | (R extends Record<201, infer R201> ? ResponseContentOf<R201> : never)
  | (R extends Record<204, any> ? undefined : never);

type ResponseType<P extends keyof paths, M extends HttpMethod> = SuccessResponse<ResponsesOf<Operation<P, M>>>;

type RequestBodyOf<Op> = Op extends { requestBody: infer RB }
  ? RB extends { content: infer C }
    ? C extends Record<string, any>
      ? C[keyof C]
      : never
    : never
  : never;

type RequestBodyType<P extends keyof paths, M extends HttpMethod> = RequestBodyOf<Operation<P, M>>;

type ApiCallOptions<TBody> = {
  body?: TBody;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

export async function typedApiJson<P extends keyof paths, M extends HttpMethod>(
  method: M,
  path: P,
  options: ApiCallOptions<RequestBodyType<P, M>> = {},
): Promise<ResponseType<P, M>> {
  return await apiJson<ResponseType<P, M>>(path as string, {
    method: method.toUpperCase(),
    signal: options.signal,
    headers: options.headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}
