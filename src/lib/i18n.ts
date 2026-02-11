/**
 * Internationalization helper
 * Unified i18n functions extracted from popup.js, main.js, settings.js
 */

/** Get a translated message by key */
export function getMessage(key: string, substitutions?: string | string[]): string {
    return chrome.i18n.getMessage(key, substitutions) || key;
}
