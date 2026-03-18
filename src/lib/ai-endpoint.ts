import { normalizeStr } from './utils';

/**
 * Coerce a user-provided "base URL" into an OpenAI-compatible chat-completions endpoint.
 *
 * Examples:
 * - https://api.moonshot.cn/v1         -> https://api.moonshot.cn/v1/chat/completions
 * - https://api.openai.com/v1/         -> https://api.openai.com/v1/chat/completions
 * - https://api.deepseek.com/v1/chat/completions (unchanged)
 */
export function toChatCompletionsEndpoint(rawEndpoint: string): string {
    const endpoint = normalizeStr(rawEndpoint);
    if (!endpoint) return '';

    // Already a chat-completions endpoint.
    if (/\/chat\/completions\/?$/i.test(endpoint)) return endpoint;

    // If the user provides a base OpenAI-compatible `/v1`, append the path.
    try {
        const url = new URL(endpoint);
        const path = url.pathname.replace(/\/+$/, '');
        if (path === '/v1' || path.endsWith('/v1')) {
            url.pathname = `${path}/chat/completions`;
            return url.toString();
        }
    } catch {
        // ignore parse errors; fall through and return original string
    }

    return endpoint;
}

