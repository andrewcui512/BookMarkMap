export type ThemeMode = 'auto' | 'light' | 'dark';

export function normalizeThemeMode(mode: unknown): ThemeMode {
    return mode === 'light' || mode === 'dark' ? mode : 'auto';
}

export function applyThemeMode(mode: ThemeMode, root: HTMLElement = document.documentElement): void {
    root.classList.remove('light-mode', 'dark-mode');
    if (mode === 'light') root.classList.add('light-mode');
    if (mode === 'dark') root.classList.add('dark-mode');
}
