/**
 * Settings Page — React migration
 */

import { useState, useEffect, useCallback } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { useI18n } from '@/hooks/useI18n';
import { ToastContainer, useToast } from '@/components/Toast';
import { callBackground } from '@/lib/utils';
import { maskKey } from '@/lib/utils';
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
        if (darkMode === 'dark') {
            document.documentElement.classList.add('dark-mode');
        } else if (darkMode === 'light') {
            document.documentElement.classList.remove('dark-mode');
        } else {
            document.documentElement.classList.remove('dark-mode');
        }
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
        showToast(t('saved') || '已保存', 'success');
    }, [settings, darkMode, language, whitelist, apiEndpoint, apiKey, model, save, showToast, t]);

    const handleTest = async () => {
        setTesting(true);
        try {
            const result = await callBackground<any>({ type: 'TEST_AI_CONNECTION' });
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
                <h1>⚙️ {t('settings') || '设置'}</h1>
            </header>

            <div className="settings-content">
                {/* Appearance */}
                <section className="settings-section card">
                    <h2>{t('appearance') || '外观'}</h2>
                    <div className="settings-field">
                        <label>{t('darkMode') || '深色模式'}</label>
                        <select value={darkMode} onChange={e => setDarkMode(e.target.value)}>
                            <option value="auto">{t('auto') || '跟随系统'}</option>
                            <option value="light">{t('light') || '浅色'}</option>
                            <option value="dark">{t('dark') || '深色'}</option>
                        </select>
                    </div>
                    <div className="settings-field">
                        <label>{t('language') || '语言'}</label>
                        <select value={language} onChange={e => setLanguage(e.target.value)}>
                            <option value="zh_CN">简体中文</option>
                            <option value="en">English</option>
                        </select>
                    </div>
                </section>

                {/* AI Config */}
                <section className="settings-section card">
                    <h2>🤖 {t('aiConfig') || 'AI 配置'}</h2>
                    <p className="settings-hint">{t('aiConfigHint') || '配置当前 AI 服务（推荐在 AI 分类页管理多个配置）'}</p>
                    <div className="settings-field">
                        <label>{t('apiEndpoint') || 'API 端点'}</label>
                        <input type="url" value={apiEndpoint} onChange={e => setApiEndpoint(e.target.value)} placeholder="https://api.example.com/v1/chat/completions" />
                    </div>
                    <div className="settings-field">
                        <label>{t('apiKey') || 'API 密钥'}</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <input type={showKey ? 'text' : 'password'} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." style={{ flex: 1 }} />
                            <button className="btn btn-sm" onClick={() => setShowKey(!showKey)}>{showKey ? '🙈' : '👁️'}</button>
                        </div>
                    </div>
                    <div className="settings-field">
                        <label>{t('model') || '模型'}</label>
                        <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder="gpt-3.5-turbo" />
                    </div>
                    <button className="btn" onClick={handleTest} disabled={testing}>
                        {testing ? '⏳ ...' : `🔌 ${t('testConnection') || '测试连接'}`}
                    </button>
                </section>

                {/* Firewall whitelist */}
                <section className="settings-section card">
                    <h2>🛡️ {t('firewallWhitelist') || '防火墙白名单'}</h2>
                    <p className="settings-hint">{t('firewallHint') || '这些域名在检测失效链接时将被跳过（每行一个）'}</p>
                    <textarea rows={6} value={whitelist} onChange={e => setWhitelist(e.target.value)} placeholder="google.com&#10;youtube.com" />
                </section>

                {/* Save */}
                <div className="settings-actions">
                    <button className="btn btn-primary" onClick={handleSave}>
                        💾 {t('save') || '保存设置'}
                    </button>
                    <span className="settings-shortcut">Ctrl+S</span>
                </div>
            </div>

            <ToastContainer toasts={toasts} />
        </div>
    );
}
