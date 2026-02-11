/**
 * AI Classification Page — React migration with undo & manual edit
 */

import { useState, useEffect, useCallback } from 'react';
import { useBookmarks } from '@/hooks/useBookmarks';
import { useSettings } from '@/hooks/useSettings';
import { useI18n } from '@/hooks/useI18n';
import { ToastContainer, useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { callBackground, randomId, now, formatTime, maskKey } from '@/lib/utils';
import { PROVIDER_PRESETS, isConfigReady, ensureConfigStats, getProviderLabel } from '@/lib/ai-config';
import * as bm from '@/lib/bookmark-manager';
import type { AiConfig, ClassifyCategory, OperationRecord, MoveRecord, BookmarkNode } from '@/types/bookmark';
import './ai.css';

interface EditableCategory {
    category: string;
    bookmarks: { id: string; title: string; url: string; excluded?: boolean }[];
}

export default function App() {
    const { t } = useI18n();
    const { bookmarks, load } = useBookmarks();
    const { settings, save: saveSettings } = useSettings();
    const { toasts, show: showToast } = useToast();

    // AI config state
    const [configModalOpen, setConfigModalOpen] = useState(false);
    const [editingConfig, setEditingConfig] = useState<Partial<AiConfig> | null>(null);
    const [testing, setTesting] = useState<string | null>(null);

    // Classification state
    const [classifyLoading, setClassifyLoading] = useState(false);
    const [classifyResults, setClassifyResults] = useState<EditableCategory[]>([]);
    const [parentFolderId, setParentFolderId] = useState('1');
    const [applying, setApplying] = useState(false);

    // History state
    const [historyOpen, setHistoryOpen] = useState(false);
    const [operations, setOperations] = useState<OperationRecord[]>([]);
    const [rollingBack, setRollingBack] = useState(false);

    useEffect(() => { load(); }, [load]);

    const configs = settings?.aiConfigs || [];
    const activeId = settings?.activeAiConfigId;
    const activeConfig = configs.find(c => c.id === activeId);

    // Switch active config
    const setActive = async (id: string) => {
        if (!settings) return;
        await saveSettings({ ...settings, activeAiConfigId: id });
    };

    // Open config modal (new or edit)
    const openConfigModal = (config?: AiConfig) => {
        if (config) {
            setEditingConfig({ ...config });
        } else {
            setEditingConfig({ id: '', label: '', providerId: 'custom', apiEndpoint: '', apiKey: '', model: '' });
        }
        setConfigModalOpen(true);
    };

    // Save config
    const saveConfig = async () => {
        if (!settings || !editingConfig) return;
        const updated = { ...settings };
        if (editingConfig.id && configs.find(c => c.id === editingConfig.id)) {
            // Update existing
            updated.aiConfigs = configs.map(c => c.id === editingConfig.id ? { ...c, ...editingConfig } as AiConfig : c);
        } else {
            // New config
            const newConfig: AiConfig = {
                ...editingConfig,
                id: randomId(),
                stats: { totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, lastUsed: null, history: [] },
            } as AiConfig;
            updated.aiConfigs = [...configs, newConfig];
            if (!updated.activeAiConfigId) updated.activeAiConfigId = newConfig.id;
        }
        await saveSettings(updated);
        setConfigModalOpen(false);
        showToast(t('saved') || '已保存', 'success');
    };

    // Delete config
    const deleteConfig = async (id: string) => {
        if (!settings || !confirm(t('confirmDelete') || '确认删除？')) return;
        const updated = { ...settings, aiConfigs: configs.filter(c => c.id !== id) };
        if (updated.activeAiConfigId === id) updated.activeAiConfigId = updated.aiConfigs[0]?.id || null;
        await saveSettings(updated);
    };

    // Test connection
    const testConfig = async (configId: string) => {
        setTesting(configId);
        try {
            const res = await callBackground<any>({ type: 'TEST_AI_CONNECTION', configId });
            if (res.error) throw new Error(res.error);
            showToast(`✅ ${res.reply} (${res.elapsed}ms)`, 'success');
        } catch (err) {
            showToast(`❌ ${(err as Error).message}`, 'error');
        } finally {
            setTesting(null);
        }
    };

    // Run classify
    const runClassify = async () => {
        setClassifyLoading(true);
        setClassifyResults([]);
        try {
            const allBm = bm.flatten(bookmarks as unknown as BookmarkNode[]);
            if (allBm.length === 0) { showToast(t('noBookmarks') || '暂无书签', 'warning'); return; }
            const data = allBm.map(b => ({ id: b.id, title: b.title, url: b.url || '' }));
            const res = await callBackground<any>({ type: 'CLASSIFY_BOOKMARKS', bookmarks: data });
            if (res.error) throw new Error(res.error);
            const categories: EditableCategory[] = (res.categories || []).map((c: ClassifyCategory) => ({
                category: c.category,
                bookmarks: c.bookmarks.map(b => ({ ...b, excluded: false })),
            }));
            setClassifyResults(categories);
            showToast(t('classifyDone') || '分类完成', 'success');
        } catch (err) {
            showToast(`❌ ${(err as Error).message}`, 'error');
        } finally {
            setClassifyLoading(false);
        }
    };

    // Manual edit: rename category
    const renameCategory = (idx: number, newName: string) => {
        setClassifyResults(prev => prev.map((c, i) => i === idx ? { ...c, category: newName } : c));
    };

    // Manual edit: toggle exclude bookmark
    const toggleExclude = (catIdx: number, bmIdx: number) => {
        setClassifyResults(prev => prev.map((c, ci) =>
            ci === catIdx ? { ...c, bookmarks: c.bookmarks.map((b, bi) => bi === bmIdx ? { ...b, excluded: !b.excluded } : b) } : c
        ));
    };

    // Manual edit: merge two categories
    const mergeCategories = (fromIdx: number, toIdx: number) => {
        setClassifyResults(prev => {
            const next = [...prev];
            next[toIdx] = { ...next[toIdx], bookmarks: [...next[toIdx].bookmarks, ...next[fromIdx].bookmarks] };
            next.splice(fromIdx, 1);
            return next;
        });
    };

    // Manual edit: delete category
    const deleteCategory = (idx: number) => {
        setClassifyResults(prev => prev.filter((_, i) => i !== idx));
    };

    // Apply classification
    const applyClassify = async () => {
        setApplying(true);
        try {
            const moves: MoveRecord[] = [];
            const foldersCreated: string[] = [];
            const folderCache: Record<string, string> = {};

            for (const cat of classifyResults) {
                const activeBookmarks = cat.bookmarks.filter(b => !b.excluded);
                if (activeBookmarks.length === 0) continue;

                // Get or create folder
                let folderId = folderCache[cat.category];
                if (!folderId) {
                    const search = await bm.searchApi(cat.category);
                    const existing = search.find(s => !s.url && s.title === cat.category && s.parentId === parentFolderId);
                    if (existing) {
                        folderId = existing.id;
                    } else {
                        const created = await bm.createFolder(parentFolderId, cat.category);
                        folderId = created.id;
                        foldersCreated.push(folderId);
                    }
                    folderCache[cat.category] = folderId;
                }

                // Move bookmarks
                for (const bookmark of activeBookmarks) {
                    const current = await bm.getNode(bookmark.id);
                    moves.push({
                        bookmarkId: bookmark.id,
                        fromParentId: current.parentId || '1',
                        fromIndex: current.index || 0,
                        toParentId: folderId,
                    });
                    await bm.move(bookmark.id, folderId);
                }
            }

            // Save operation for undo
            const operation: OperationRecord = {
                id: randomId(),
                timestamp: now(),
                description: `分类: ${classifyResults.map(c => c.category).join(', ')}`,
                moves,
                foldersCreated,
            };
            await callBackground({ type: 'SAVE_OPERATION', operation });

            showToast(t('applied') || '分类已应用', 'success');
            setClassifyResults([]);
            load();
        } catch (err) {
            showToast(`❌ ${(err as Error).message}`, 'error');
        } finally {
            setApplying(false);
        }
    };

    // Load operation history
    const loadHistory = async () => {
        const res = await callBackground<{ operations: OperationRecord[] }>({ type: 'GET_OPERATIONS' });
        setOperations(res.operations || []);
        setHistoryOpen(true);
    };

    // Rollback operation
    const rollback = async (op: OperationRecord) => {
        setRollingBack(true);
        try {
            // Reverse moves (in reverse order)
            for (const move of [...op.moves].reverse()) {
                await bm.move(move.bookmarkId, move.fromParentId, move.fromIndex);
            }
            // Delete created folders (if now empty)
            for (const folderId of op.foldersCreated) {
                try {
                    const children = await bm.getChildren(folderId);
                    if (children.length === 0) await bm.remove(folderId);
                } catch { /* folder may already be deleted */ }
            }
            await callBackground({ type: 'DELETE_OPERATION', operationId: op.id });
            setOperations(prev => prev.filter(o => o.id !== op.id));
            showToast(t('rolledBack') || '已回滚', 'success');
            load();
        } catch (err) {
            showToast(`❌ ${(err as Error).message}`, 'error');
        } finally {
            setRollingBack(false);
        }
    };

    const folderOptions = collectFolders(bookmarks as unknown as BookmarkNode[]);

    return (
        <div className="ai-container">
            <header className="ai-header">
                <h1>🤖 AI {t('classify') || '智能分类'}</h1>
                <button className="btn" onClick={loadHistory}>📜 {t('history') || '操作历史'}</button>
            </header>

            <div className="ai-content">
                {/* Config Cards */}
                <section className="ai-section">
                    <div className="ai-section-header">
                        <h2>{t('aiConfigs') || 'API 配置'}</h2>
                        <button className="btn btn-sm btn-primary" onClick={() => openConfigModal()}>➕ {t('addConfig') || '添加'}</button>
                    </div>
                    <div className="config-grid">
                        {configs.map(c => (
                            <div key={c.id} className={`config-card card ${c.id === activeId ? 'active' : ''}`}>
                                <div className="config-card-header">
                                    <strong>{c.label || getProviderLabel(c.providerId)}</strong>
                                    {c.id === activeId && <span className="badge badge-success">{t('current') || '当前'}</span>}
                                </div>
                                <div className="config-card-info">
                                    <span>{c.model || '—'}</span>
                                    <span className="config-card-key">{maskKey(c.apiKey)}</span>
                                </div>
                                <div className="config-card-stats">
                                    {ensureConfigStats(c) && <span>{c.stats.totalRequests} 次 · {c.stats.totalTokens} tokens</span>}
                                </div>
                                <div className="config-card-actions">
                                    {c.id !== activeId && <button className="btn btn-sm" onClick={() => setActive(c.id)}>✅ {t('use') || '使用'}</button>}
                                    <button className="btn btn-sm" onClick={() => testConfig(c.id)} disabled={testing === c.id}>{testing === c.id ? '⏳' : '🔌'} {t('test') || '测试'}</button>
                                    <button className="btn btn-sm" onClick={() => openConfigModal(c)}>✏️</button>
                                    <button className="btn btn-sm btn-danger" onClick={() => deleteConfig(c.id)}>🗑️</button>
                                </div>
                            </div>
                        ))}
                        {configs.length === 0 && <p className="ai-hint">{t('noConfigs') || '暂无配置，请点击"添加"创建'}</p>}
                    </div>
                </section>

                {/* Classify */}
                <section className="ai-section">
                    <div className="ai-section-header">
                        <h2>{t('classify') || '分类'}</h2>
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
                        <label>{t('targetFolder') || '目标文件夹'}:</label>
                        <select value={parentFolderId} onChange={e => setParentFolderId(e.target.value)}>
                            {folderOptions.map(f => <option key={f.id} value={f.id}>{'　'.repeat(f.depth)}{f.title}</option>)}
                        </select>
                        <button className="btn btn-primary" onClick={runClassify} disabled={classifyLoading || !isConfigReady(activeConfig)}>
                            {classifyLoading ? '⏳ 分类中...' : '🚀 开始分类'}
                        </button>
                    </div>

                    {/* Results (editable) */}
                    {classifyResults.length > 0 && (
                        <div className="classify-results">
                            <div className="classify-results-header">
                                <h3>📋 {t('results') || '分类结果'}（可编辑）</h3>
                                <button className="btn btn-primary" onClick={applyClassify} disabled={applying}>
                                    {applying ? '⏳ 应用中...' : '✅ 全部应用'}
                                </button>
                            </div>
                            {classifyResults.map((cat, catIdx) => (
                                <div key={catIdx} className="classify-category card">
                                    <div className="classify-category-header">
                                        <input
                                            className="classify-category-name"
                                            value={cat.category}
                                            onChange={e => renameCategory(catIdx, e.target.value)}
                                        />
                                        <span className="badge badge-info">{cat.bookmarks.filter(b => !b.excluded).length}</span>
                                        <button className="btn btn-sm btn-danger" onClick={() => deleteCategory(catIdx)} title={t('delete') || '删除分类'}>✕</button>
                                    </div>
                                    <div className="classify-bookmarks">
                                        {cat.bookmarks.map((bk, bkIdx) => (
                                            <div key={bk.id} className={`classify-bookmark ${bk.excluded ? 'excluded' : ''}`}>
                                                <input type="checkbox" checked={!bk.excluded} onChange={() => toggleExclude(catIdx, bkIdx)} />
                                                <span className="classify-bookmark-title">{bk.title}</span>
                                                <span className="classify-bookmark-url">{bk.url}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            {/* Config Modal */}
            <Modal open={configModalOpen} onClose={() => setConfigModalOpen(false)} title={editingConfig?.id ? (t('editConfig') || '编辑配置') : (t('addConfig') || '添加配置')}
                footer={<><button className="btn" onClick={() => setConfigModalOpen(false)}>{t('cancel') || '取消'}</button><button className="btn btn-primary" onClick={saveConfig}>{t('save') || '保存'}</button></>}>
                {editingConfig && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div><label>名称</label><input type="text" value={editingConfig.label || ''} onChange={e => setEditingConfig({ ...editingConfig, label: e.target.value })} /></div>
                        <div><label>服务商</label><select value={editingConfig.providerId || 'custom'} onChange={e => {
                            const preset = PROVIDER_PRESETS.find(p => p.id === e.target.value);
                            setEditingConfig({ ...editingConfig, providerId: e.target.value, apiEndpoint: preset?.apiEndpoint || editingConfig.apiEndpoint, model: preset?.model || editingConfig.model });
                        }}>
                            {PROVIDER_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select></div>
                        <div><label>API 端点</label><input type="url" value={editingConfig.apiEndpoint || ''} onChange={e => setEditingConfig({ ...editingConfig, apiEndpoint: e.target.value })} /></div>
                        <div><label>API 密钥</label><input type="password" value={editingConfig.apiKey || ''} onChange={e => setEditingConfig({ ...editingConfig, apiKey: e.target.value })} /></div>
                        <div><label>模型</label><input type="text" value={editingConfig.model || ''} onChange={e => setEditingConfig({ ...editingConfig, model: e.target.value })} /></div>
                    </div>
                )}
            </Modal>

            {/* History Modal */}
            <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title={t('history') || '操作历史'} width="600px">
                {operations.length === 0 ? (
                    <p>{t('noHistory') || '暂无操作记录'}</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {operations.map(op => (
                            <div key={op.id} className="history-item card">
                                <div><strong>{op.description}</strong></div>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatTime(op.timestamp)} · {op.moves.length} 项移动</div>
                                <button className="btn btn-sm" onClick={() => rollback(op)} disabled={rollingBack}>
                                    ↩️ {t('rollback') || '回滚'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </Modal>

            <ToastContainer toasts={toasts} />
        </div>
    );
}

// Helper
interface FolderOption { id: string; title: string; depth: number }
function collectFolders(nodes: BookmarkNode[], depth = 0): FolderOption[] {
    const result: FolderOption[] = [];
    for (const node of nodes) {
        if (!node.url) {
            result.push({ id: node.id, title: node.title || '未命名', depth });
            if (node.children) result.push(...collectFolders(node.children, depth + 1));
        }
    }
    return result;
}
