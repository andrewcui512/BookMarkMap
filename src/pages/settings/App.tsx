/**
 * Settings Page — React migration
 */

import { useState, useEffect, useCallback } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { useI18n } from '@/hooks/useI18n';
import { ToastContainer, useToast } from '@/components/Toast';
import { callBackground } from '@/lib/utils';
import { ensureOriginsPermission, urlToOriginPattern } from '@/lib/permissions';
import { applyThemeMode, normalizeThemeMode } from '@/lib/theme';
import './settings.css';

export default function App() {
    const { t } = useI18n();
    const { settings, loading, save } = useSettings();
    const { toasts, show: showToast } = useToast();

    const [darkMode, setDarkMode] = useState('auto');
    const [language, setLanguage] = useState('zh_CN');
    const [apiEndpoint, setApiEndpoint] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [whitelist, setWhitelist] = useState('');
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        if (!settings) return;
        setDarkMode(settings.darkMode || 'auto');
        setLanguage(settings.language || 'zh_CN');
        setWhitelist((settings.firewallWhitelist || []).join('\n'));
        // Show active AI config if exists
        const active = settings.aiConfigs?.find(c => c.id === settings.activeAiConfigId);
        if (active) {
            setApiEndpoint(active.apiEndpoint || '');
            setApiKey(active.apiKey || '');
            setModel(active.model || '');
        }
    }, [settings]);

    // Apply dark mode
    useEffect(() => {
        applyThemeMode(normalizeThemeMode(darkMode));
    }, [darkMode]);

    const handleSave = useCallback(async () => {
        if (!settings) return;
        const updated = {
            ...settings,
            darkMode: darkMode as 'auto' | 'light' | 'dark',
            language,
            firewallWhitelist: whitelist.split('\n').map(s => s.trim()).filter(Boolean),
        };
        // Update active AI config
        const active = updated.aiConfigs?.find(c => c.id === updated.activeAiConfigId);
        if (active) {
            active.apiEndpoint = apiEndpoint;
            active.apiKey = apiKey;
            active.model = model;
        }
        await save(updated);
        showToast(t('saved'), 'success');
    }, [settings, darkMode, language, whitelist, apiEndpoint, apiKey, model, save, showToast, t]);

    const handleTest = async () => {
        setTesting(true);
        try {
            const active = settings?.aiConfigs?.find(c => c.id === settings.activeAiConfigId);
            const endpoint = active?.apiEndpoint || apiEndpoint;
            const origin = endpoint ? urlToOriginPattern(endpoint) : null;
            if (!origin) throw new Error(t('apiEndpointInvalid'));
            const granted = await ensureOriginsPermission([origin]);
            if (!granted) throw new Error(t('apiPermissionRequired'));

            let result = await callBackground<any>({ type: 'TEST_AI_CONNECTION' });
            if (result?.error && /unknown message type/i.test(String(result.error || ''))) {
                result = await callBackground<any>({ type: 'AI_TEST' });
            }
            if (result.error) throw new Error(result.error);
            showToast(`✅ ${result.reply} (${result.elapsed}ms)`, 'success');
        } catch (err) {
            showToast(`❌ ${(err as Error).message}`, 'error');
        } finally {
            setTesting(false);
        }
    };

    // Keyboard shortcut
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [handleSave]);

    if (loading || !settings) {
        return <div className="settings-loading"><div className="spinner" /></div>;
    }

    return (
        <div className="settings-container">
            <header className="settings-header">
                <h1>⚙️ {t('settings')}</h1>
            </header>

            <div className="settings-content">
                {/* Appearance */}
                <section className="settings-section card">
                    <h2>{t('appearance')}</h2>
                    <div className="settings-field">
                        <label>{t('darkMode')}</label>
                        <select value={darkMode} onChange={e => setDarkMode(e.target.value)}>
                            <option value="auto">{t('auto')}</option>
                            <option value="light">{t('light')}</option>
                            <option value="dark">{t('dark')}</option>
                        </select>
                    </div>
                    <div className="settings-field">
                        <label>{t('language')}</label>
                        <select value={language} onChange={e => setLanguage(e.target.value)}>
                            <option value="zh_CN">{t('langZhCN')}</option>
                            <option value="en">{t('langEn')}</option>
                        </select>
                    </div>
                </section>

                {/* AI Config */}
                <section className="settings-section card">
                    <h2>🤖 {t('aiConfig')}</h2>
                    <p className="settings-hint">{t('aiConfigHint')}</p>
                    <div className="settings-field">
                        <label>{t('apiEndpoint')}</label>
                        <input type="url" value={apiEndpoint} onChange={e => setApiEndpoint(e.target.value)} placeholder={t('apiEndpointPlaceholder')} />
                    </div>
                    <div className="settings-field">
                        <label>{t('apiKey')}</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <input type={showKey ? 'text' : 'password'} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={t('apiKeyPlaceholder')} style={{ flex: 1 }} />
                            <button className="btn btn-sm" onClick={() => setShowKey(!showKey)}>{showKey ? '🙈' : '👁️'}</button>
                        </div>
                    </div>
                    <div className="settings-field">
                        <label>{t('model')}</label>
                        <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder={t('modelPlaceholder')} />
                    </div>
                    <button className="btn" onClick={handleTest} disabled={testing}>
                        {testing ? '⏳ ...' : `🔌 ${t('testConnection')}`}
                    </button>
                </section>

                {/* Firewall whitelist */}
                <section className="settings-section card">
                    <h2>🛡️ {t('firewallWhitelist')}</h2>
                    <p className="settings-hint">{t('firewallWhitelistDesc')}</p>
                    <textarea rows={6} value={whitelist} onChange={e => setWhitelist(e.target.value)} placeholder={t('firewallWhitelistPlaceholder')} />
                </section>

                {/* Privacy */}
                <section className="settings-section card">
                    <h2>🔒 {t('privacy')}</h2>
                    <p className="settings-hint">{t('privacyHint')}</p>
                    <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <li>{t('privacyApiKey')}</li>
                        <li>{t('privacyAiData')}</li>
                        <li>{t('privacyLinkCheck')}</li>
                    </ul>
                </section>

                {/* Save */}
                <div className="settings-actions">
                    <button className="btn btn-primary" onClick={handleSave}>
                        💾 {t('saveSettings')}
                    </button>
                    <span className="settings-shortcut">Ctrl+S</span>
                </div>
            </div>

            <ToastContainer toasts={toasts} />
        </div>
    );
}
