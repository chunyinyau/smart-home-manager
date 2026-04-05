function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function readEnvValue(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

export function resolvePublicEndpointUrl(
  keys: string[],
  params: Record<string, string | number> = {},
): string | null {
  const template = readEnvValue(keys);
  if (!template) {
    return null;
  }

  const resolved = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : encodeURIComponent(String(value));
  });

  return normalizeUrl(resolved);
}

interface PublicEndpointOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  timeoutMs?: number;
}

export async function fetchPublicEndpoint(
  keys: string[],
  params: Record<string, string | number> = {},
  options: PublicEndpointOptions = {},
): Promise<Response | null> {
  const url = resolvePublicEndpointUrl(keys, params);
  if (!url) {
    return null;
  }

  const { body, timeoutMs = 12000, headers, ...requestInit } = options;
  const resolvedHeaders = new Headers(headers);

  let requestBody: BodyInit | undefined;
  if (body !== undefined) {
    requestBody = JSON.stringify(body);
    if (!resolvedHeaders.has("Content-Type")) {
      resolvedHeaders.set("Content-Type", "application/json");
    }
  }

  return fetch(url, {
    ...requestInit,
    headers: resolvedHeaders,
    body: requestBody,
    cache: requestInit.cache ?? "no-store",
    signal: requestInit.signal ?? AbortSignal.timeout(timeoutMs),
  });
}
