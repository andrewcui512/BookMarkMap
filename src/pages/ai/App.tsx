/**
 * AI Classification Page — React migration with undo & manual edit
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useBookmarks } from '@/hooks/useBookmarks';
import { useSettings } from '@/hooks/useSettings';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { ToastContainer, useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { callBackground, randomId, now, formatTime, maskKey } from '@/lib/utils';
import { PROVIDER_PRESETS, isConfigReady, ensureConfigStats, getProviderLabel } from '@/lib/ai-config';
import { ensureOriginsPermission, urlToOriginPattern } from '@/lib/permissions';
import * as bm from '@/lib/bookmark-manager';
import type { AiConfig, OperationRecord, MoveRecord, BookmarkNode, PrunedFolderRecord } from '@/types/bookmark';
import './ai.css';

interface EditableCategory {
    category: string;
    reason?: string;
    bookmarks: { id: string; title: string; url: string; excluded?: boolean }[];
}

function isUnknownMessageTypeError(msg: unknown): boolean {
    return /unknown message type/i.test(String(msg || ''));
}

type ApplyAction = 'reuse' | 'create';
interface ExistingCandidate { id: string; path: string }
interface ApplyPlanItem {
    id: string;
    categoryName: string;
    bookmarkIds: string[];
    existingFolderId: string | null;
    existingCandidates: ExistingCandidate[];
    action: ApplyAction;
    createTitle: string;
}

const PROTECTED_FOLDER_IDS = new Set(['0', '1', '2', '3']);

export default function App() {
    const { t } = useI18n();
    useTheme();
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
    const [classifyLogs, setClassifyLogs] = useState<string[]>([]);
    const [classifyOpId, setClassifyOpId] = useState<string | null>(null);
    const classifyOpIdRef = useRef<string | null>(null);

    // Apply precheck
    const [precheckOpen, setPrecheckOpen] = useState(false);
    const [prechecking, setPrechecking] = useState(false);
    const [applyPlan, setApplyPlan] = useState<ApplyPlanItem[]>([]);

    // Merge categories
    const [mergeOpen, setMergeOpen] = useState(false);
    const [mergeFromIdx, setMergeFromIdx] = useState<number | null>(null);
    const [mergeToIdx, setMergeToIdx] = useState<number | null>(null);

    // History state
    const [historyOpen, setHistoryOpen] = useState(false);
    const [operations, setOperations] = useState<OperationRecord[]>([]);
    const [rollingBack, setRollingBack] = useState(false);

    useEffect(() => { load(); }, [load]);

    // Realtime logs from background during classification
    useEffect(() => {
        const handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message: any) => {
            if (!message || message.type !== 'AI_CLASSIFY_LOG') return;
            const opId = String(message.opId || '');
            if (!opId || opId !== (classifyOpIdRef.current || '')) return;

            const level = String(message.level || 'info').toUpperCase();
            const timeStr = message.time ? new Date(message.time).toLocaleTimeString() : '';
            const text = String(message.message || '');
            const line = `${timeStr ? `${timeStr} ` : ''}[${level}] ${text}`.trim();

            setClassifyLogs((prev) => {
                const next = [...prev, line];
                if (next.length > 600) next.splice(0, next.length - 600);
                return next;
            });
        };
        chrome.runtime.onMessage.addListener(handler);
        return () => chrome.runtime.onMessage.removeListener(handler);
    }, []);

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
            const config = configs.find(c => c.id === configId);
            const origin = config?.apiEndpoint ? urlToOriginPattern(config.apiEndpoint) : null;
            if (!origin) throw new Error(t('apiEndpointInvalid'));
            const granted = await ensureOriginsPermission([origin]);
            if (!granted) throw new Error(t('apiPermissionRequired'));

            let res = await callBackground<any>({ type: 'TEST_AI_CONNECTION', configId });
            if (res?.error && isUnknownMessageTypeError(res.error)) {
                res = await callBackground<any>({ type: 'AI_TEST', configId });
            }
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
        const opId = randomId();
        classifyOpIdRef.current = opId;
        setClassifyOpId(opId);
        setClassifyLogs([]);
        try {
            const origin = activeConfig?.apiEndpoint ? urlToOriginPattern(activeConfig.apiEndpoint) : null;
            if (!origin) throw new Error(t('apiEndpointInvalid'));
            const configId = activeId || null;
            const apiGranted = await ensureOriginsPermission([origin]);
            if (!apiGranted) throw new Error(t('apiPermissionRequired'));

            const allBm = bm.flatten(bookmarks as unknown as BookmarkNode[]);
            if (allBm.length === 0) { showToast(t('noBookmarks') || '暂无书签', 'warning'); return; }

            const data = allBm.map(b => ({ id: b.id, title: b.title, url: b.url || '' }));
            const res = await callBackground<any>({
                type: 'AI_CLASSIFY_ALL_BOOKMARKS',
                bookmarks: data,
                configId,
                opId,
                parentFolderId,
            });
            if (res?.error) {
                if (isUnknownMessageTypeError(res.error)) {
                    throw new Error('当前扩展版本不支持全量分类，请重新构建并重载扩展后再试。');
                }
                throw new Error(String(res.error));
            }

            const defaultCategoryName = String(
                res?.defaultCategoryName
                || '未分类(AI)'
            );

            const categories: EditableCategory[] = (Array.isArray(res?.categories) ? res.categories : [])
                .map((c: any) => ({
                    category: String(c?.category || '').trim(),
                    reason: c?.reason ? String(c.reason) : undefined,
                    bookmarks: (Array.isArray(c?.bookmarks) ? c.bookmarks : [])
                        .map((b: any) => ({
                            id: String(b?.id || '').trim(),
                            title: String(b?.title || ''),
                            url: String(b?.url || ''),
                            excluded: false,
                        }))
                        .filter((b: any) => !!b.id),
                }))
                .filter((c: EditableCategory) => !!c.category && c.bookmarks.length > 0)
                .sort((a: EditableCategory, b: EditableCategory) => {
                    const aDefault = a.category === defaultCategoryName ? 1 : 0;
                    const bDefault = b.category === defaultCategoryName ? 1 : 0;
                    if (aDefault !== bDefault) return aDefault - bDefault;
                    return (b.bookmarks.length - a.bookmarks.length) || a.category.localeCompare(b.category);
                });

            setClassifyResults(categories);

            const summary = (res?.summary && typeof res.summary === 'object') ? res.summary : {};
            const total = Number(summary.total || data.length);
            const assigned = Number(summary.assigned || categories.reduce((sum, c) => sum + c.bookmarks.length, 0));
            const uncategorized = Number(summary.uncategorized || 0);
            const failed = Number(summary.failed || res?.failed || 0);

            showToast(t('classifyDone') || '分类完成', 'success');
            if (assigned > 0 || total > 0) {
                showToast(`覆盖 ${assigned}/${total} 条书签`, 'info');
            }
            if (uncategorized > 0) {
                showToast(`${uncategorized} 条进入“${defaultCategoryName}”`, 'warning');
            }
            if (failed > 0) {
                showToast(`${failed} 条请求失败已自动并入“${defaultCategoryName}”`, 'warning');
            }

            const reasonLines = categories.filter((c) => !!c.reason).map((c) => `【${c.category}】${c.reason}`);
            if (reasonLines.length > 0) {
                setClassifyLogs((prev) => {
                    const next = [...prev, '— 分类原因 —', ...reasonLines];
                    if (next.length > 600) next.splice(0, next.length - 600);
                    return next;
                });
            }
        } catch (err) {
            showToast(`❌ ${(err as Error).message}`, 'error');
        } finally {
            setClassifyLoading(false);
        }
    };

    const copyClassifyLogs = async () => {
        try {
            const text = classifyLogs.join('\n').trim();
            if (!text) return;
            await navigator.clipboard.writeText(text);
            showToast(t('copied') || '已复制到剪贴板', 'success');
        } catch (err) {
            showToast(`❌ ${(err as Error).message}`, 'error');
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

    const openMergeModal = (fromIdx: number) => {
        const choices = classifyResults.map((_, i) => i).filter(i => i !== fromIdx);
        setMergeFromIdx(fromIdx);
        setMergeToIdx(choices[0] ?? null);
        setMergeOpen(true);
    };

    const handleMergeConfirm = () => {
        if (mergeFromIdx === null || mergeToIdx === null) return;
        mergeCategories(mergeFromIdx, mergeToIdx);
        setMergeOpen(false);
        setMergeFromIdx(null);
        setMergeToIdx(null);
    };

    function normalizeCategoryName(name: string) {
        return String(name || '').replace(/\s+/g, ' ').trim();
    }

    function getAiCategoryNameVariants(baseName: string): string[] {
        const n = normalizeCategoryName(baseName);
        if (!n) return [];
        return Array.from(new Set([`${n}(AI)`, `${n} (AI)`]));
    }

    // Precheck: folder conflict detection before applying
    const prepareApply = async () => {
        setPrechecking(true);
        try {
            const parent = await bm.getNode(parentFolderId);
            if (parent.url) throw new Error(t('targetFolder') || '目标文件夹无效');

            const activeCategories = classifyResults
                .map((c) => ({ name: normalizeCategoryName(c.category), bookmarkIds: c.bookmarks.filter(b => !b.excluded).map(b => b.id) }))
                .filter((c) => c.bookmarkIds.length > 0);

            if (activeCategories.length === 0) {
                showToast(t('nothingToApply') || '没有可应用的书签（可能都被排除）', 'info');
                return;
            }

            const emptyNames = activeCategories.filter(c => !c.name);
            if (emptyNames.length > 0) {
                showToast(t('emptyCategoryName') || '分类名称不能为空，请先重命名分类', 'error');
                return;
            }

            // Find existing folders (including deeper descendants) under target folder by title.
            const subtree = await bm.getSubTree(parentFolderId);
            const byTitle = new Map<string, ExistingCandidate[]>();
            const walk = (node: any, pathParts: string[]) => {
                if (node.url) return;
                const isRoot = node.id === parentFolderId;
                const titleKey = normalizeCategoryName(node.title || '');
                const displayTitle = normalizeCategoryName(node.title || t('untitled'));
                const nextPath = isRoot ? pathParts : [...pathParts, displayTitle];

                if (!isRoot && titleKey) {
                    const list = byTitle.get(titleKey) || [];
                    list.push({ id: node.id, path: nextPath.join(' / ') });
                    byTitle.set(titleKey, list);
                }

                (node.children || []).forEach((child: any) => walk(child, nextPath));
            };
            walk(subtree as any, []);
            for (const list of byTitle.values()) {
                list.sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
            }

            const dedupeCandidates = (list: ExistingCandidate[]) => {
                const seen = new Set<string>();
                return list.filter((c) => {
                    if (seen.has(c.id)) return false;
                    seen.add(c.id);
                    return true;
                });
            };

            const plan: ApplyPlanItem[] = activeCategories.map((cat) => {
                const baseCandidates = dedupeCandidates(byTitle.get(cat.name) || []);
                const aiCandidates = dedupeCandidates(
                    getAiCategoryNameVariants(cat.name)
                        .flatMap((name) => byTitle.get(name) || [])
                );

                let existingCandidates: ExistingCandidate[] = [];
                let existingFolderId: string | null = null;
                let action: ApplyAction = 'create';

                // Prefer reusing explicit AI folders first to avoid repeatedly creating "(AI)" duplicates.
                if (aiCandidates.length === 1) {
                    existingCandidates = aiCandidates;
                    existingFolderId = aiCandidates[0].id;
                    action = 'reuse';
                } else if (aiCandidates.length > 1) {
                    existingCandidates = aiCandidates;
                    action = 'reuse';
                } else if (baseCandidates.length === 1) {
                    existingCandidates = baseCandidates;
                    existingFolderId = baseCandidates[0].id;
                    action = 'reuse';
                } else if (baseCandidates.length > 1) {
                    existingCandidates = baseCandidates;
                    action = 'create';
                }

                const createTitle = existingCandidates.length > 0 ? `${cat.name}(AI)` : cat.name;
                return {
                    id: randomId(),
                    categoryName: cat.name,
                    bookmarkIds: cat.bookmarkIds,
                    existingFolderId,
                    existingCandidates,
                    action,
                    createTitle,
                };
            });

            setApplyPlan(plan);
            setPrecheckOpen(true);
        } catch (err) {
            showToast(`❌ ${(err as Error).message}`, 'error');
        } finally {
            setPrechecking(false);
        }
    };

    const updatePlanAction = (id: string, action: ApplyAction) => {
        setApplyPlan(prev => prev.map(p => {
            if (p.id !== id) return p;
            if (action === 'reuse' && !p.existingFolderId && p.existingCandidates.length === 1) {
                return { ...p, action, existingFolderId: p.existingCandidates[0].id };
            }
            return { ...p, action };
        }));
    };

    const updatePlanExistingFolder = (id: string, existingFolderId: string | null) => {
        setApplyPlan(prev => prev.map(p => p.id === id ? { ...p, existingFolderId } : p));
    };

    const updatePlanCreateTitle = (id: string, title: string) => {
        setApplyPlan(prev => prev.map(p => p.id === id ? { ...p, createTitle: title } : p));
    };

    // Apply classification (uses applyPlan built from precheck)
    const applyFromPlan = async () => {
        setApplying(true);
        try {
            const getBookmarkCount = async () => {
                const tree = await bm.getAll();
                return bm.flatten(tree as unknown as BookmarkNode[]).length;
            };
            const bookmarkCountBefore = await getBookmarkCount();

            const missingReuse = applyPlan.filter((p) => p.action === 'reuse' && !p.existingFolderId);
            if (missingReuse.length > 0) {
                showToast(t('selectReuseFolder') || '请选择要复用的文件夹（存在多个同名候选时需要手动选择）', 'error');
                return;
            }

            const moves: MoveRecord[] = [];
            const prunedFolders: PrunedFolderRecord[] = [];
            const foldersCreated: string[] = [];
            const createdByTitle = new Map<string, string>();
            const folderMoveCount = new Map<string, number>();
            const sourceParentIds = new Set<string>();
            const destinationFolderIds = new Set<string>();
            const removedFolderIds = new Set<string>();
            let moveFailed = 0;

            const pruneFolderIfEmptyUpward = async (startFolderId: string) => {
                let currentId = String(startFolderId || '');
                while (currentId) {
                    if (PROTECTED_FOLDER_IDS.has(currentId)) break;
                    if (currentId === parentFolderId) break;
                    if (destinationFolderIds.has(currentId)) break;
                    if (removedFolderIds.has(currentId)) break;

                    let node: chrome.bookmarks.BookmarkTreeNode;
                    try {
                        node = await bm.getNode(currentId);
                    } catch {
                        break;
                    }
                    if (!node || !!node.url) break;

                    let children: chrome.bookmarks.BookmarkTreeNode[];
                    try {
                        children = await bm.getChildren(currentId);
                    } catch {
                        break;
                    }
                    if (children.length > 0) break;

                    prunedFolders.push({
                        id: node.id,
                        title: String(node.title || ''),
                        parentId: String(node.parentId || '0'),
                        index: Number.isInteger(node.index) ? Number(node.index) : 0,
                    });

                    try {
                        await bm.remove(currentId);
                        removedFolderIds.add(currentId);
                    } catch {
                        break;
                    }

                    currentId = String(node.parentId || '');
                }
            };

            const pruneAllEmptyFolders = async () => {
                while (true) {
                    const tree = await bm.getAll();
                    const candidates: string[] = [];

                    const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
                        for (const node of nodes) {
                            if (node.url) continue;
                            if (Array.isArray(node.children) && node.children.length > 0) {
                                walk(node.children);
                            }
                            if (PROTECTED_FOLDER_IDS.has(node.id)) continue;
                            if (removedFolderIds.has(node.id)) continue;
                            if (!Array.isArray(node.children) || node.children.length === 0) {
                                candidates.push(node.id);
                            }
                        }
                    };

                    walk(tree as unknown as chrome.bookmarks.BookmarkTreeNode[]);
                    if (candidates.length === 0) break;

                    let removedInRound = 0;
                    for (const folderId of candidates) {
                        try {
                            if (removedFolderIds.has(folderId)) continue;
                            const node = await bm.getNode(folderId);
                            if (!node || !!node.url || PROTECTED_FOLDER_IDS.has(node.id)) continue;
                            const children = await bm.getChildren(folderId);
                            if (children.length > 0) continue;

                            prunedFolders.push({
                                id: node.id,
                                title: String(node.title || ''),
                                parentId: String(node.parentId || '0'),
                                index: Number.isInteger(node.index) ? Number(node.index) : 0,
                            });
                            await bm.remove(folderId);
                            removedFolderIds.add(folderId);
                            removedInRound++;
                        } catch {
                            // ignore and continue deleting other empty folders
                        }
                    }

                    if (removedInRound === 0) break;
                }
            };

            for (const item of applyPlan) {
                let folderId: string;

                if (item.action === 'reuse' && item.existingFolderId) {
                    folderId = item.existingFolderId;
                } else {
                    const title = item.createTitle.trim() || item.categoryName;
                    const cached = createdByTitle.get(title);
                    if (cached) {
                        folderId = cached;
                    } else {
                        // Reuse sibling folder with same title if it already exists, to avoid creating duplicates.
                        const siblings = await bm.getChildren(parentFolderId);
                        const existed = siblings.find((n) => !n.url && normalizeCategoryName(n.title || '') === normalizeCategoryName(title));
                        if (existed) {
                            folderId = existed.id;
                        } else {
                            const created = await bm.createFolder(parentFolderId, title);
                            folderId = created.id;
                            foldersCreated.push(folderId);
                            folderMoveCount.set(folderId, 0);
                        }
                        createdByTitle.set(title, folderId);
                    }
                }
                destinationFolderIds.add(folderId);

                for (const bookmarkId of item.bookmarkIds) {
                    try {
                        const current = await bm.getNode(bookmarkId);
                        const fromParentId = current.parentId || '1';
                        await bm.move(bookmarkId, folderId);
                        moves.push({
                            bookmarkId,
                            fromParentId,
                            fromIndex: current.index || 0,
                            toParentId: folderId,
                        });
                        sourceParentIds.add(fromParentId);
                        folderMoveCount.set(folderId, (folderMoveCount.get(folderId) || 0) + 1);
                    } catch {
                        moveFailed++;
                    }
                }
            }

            // If nothing actually moved, clean up empty created folders and stop.
            if (moves.length === 0) {
                for (const folderId of foldersCreated) {
                    try {
                        const children = await bm.getChildren(folderId);
                        if (children.length === 0) await bm.remove(folderId);
                    } catch {
                        // ignore
                    }
                }
                showToast(t('nothingApplied') || '未移动任何书签（可能已被删除或无权限）', 'warning');
                return;
            }

            // Remove any newly created but unused folders (all moves failed for that folder)
            for (const folderId of foldersCreated) {
                const count = folderMoveCount.get(folderId) || 0;
                if (count > 0) continue;
                try {
                    const children = await bm.getChildren(folderId);
                    if (children.length === 0) {
                        await bm.remove(folderId);
                        removedFolderIds.add(folderId);
                    }
                } catch {
                    // ignore
                }
            }

            for (const sourceParentId of sourceParentIds) {
                await pruneFolderIfEmptyUpward(sourceParentId);
            }
            await pruneAllEmptyFolders();

            // Save operation for undo
            const operation: OperationRecord = {
                id: randomId(),
                timestamp: now(),
                description: `分类: ${applyPlan.map(c => c.categoryName).join(', ')}`,
                moves,
                foldersCreated,
                prunedFolders,
            };
            await callBackground({ type: 'SAVE_OPERATION', operation });

            const bookmarkCountAfter = await getBookmarkCount();
            if (bookmarkCountAfter !== bookmarkCountBefore) {
                showToast(`⚠️ 书签总数异常：${bookmarkCountBefore} → ${bookmarkCountAfter}`, 'warning');
            }

            if (moveFailed > 0 || prunedFolders.length > 0) {
                const msg = `${t('applied') || '分类已应用'}（${moves.length}/${moves.length + moveFailed}${moveFailed ? `，失败 ${moveFailed}` : ''}${prunedFolders.length ? `，清理空文件夹 ${prunedFolders.length}` : ''}）`;
                showToast(msg, moveFailed > 0 ? 'warning' : 'success');
            } else {
                showToast(t('applied') || '分类已应用', 'success');
            }
            setClassifyResults([]);
            setApplyPlan([]);
            setPrecheckOpen(false);
            load({ silent: true });
        } catch (err) {
            showToast(`❌ ${(err as Error).message}`, 'error');
        } finally {
            setApplying(false);
        }
    };

    // Load operation history
    const loadHistory = async () => {
        const res = await callBackground<{ operations: OperationRecord[] }>({ type: 'GET_OPERATIONS' });
        setOperations((res.operations || []).slice().reverse());
        setHistoryOpen(true);
    };

    // Rollback operation
    const rollback = async (op: OperationRecord) => {
        setRollingBack(true);
        try {
            const restoredFolderMap = new Map<string, string>();
            const prunedFolders = Array.isArray(op.prunedFolders) ? [...op.prunedFolders] : [];
            let restoredFolders = 0;

            if (prunedFolders.length > 0) {
                const pending = [...prunedFolders];
                let stalledRounds = 0;
                while (pending.length > 0 && stalledRounds <= pending.length + 2) {
                    let progressed = false;

                    for (let i = 0; i < pending.length; i++) {
                        const folder = pending[i];
                        const parentId = restoredFolderMap.get(folder.parentId) || folder.parentId;

                        try {
                            await bm.getNode(parentId);
                        } catch {
                            continue;
                        }

                        try {
                            const createArgs: chrome.bookmarks.BookmarkCreateArg = {
                                parentId,
                                title: folder.title || (t('untitledFolder') || '未命名文件夹'),
                            };
                            if (Number.isInteger(folder.index) && folder.index >= 0) {
                                createArgs.index = folder.index;
                            }
                            const created = await chrome.bookmarks.create(createArgs);
                            restoredFolderMap.set(folder.id, created.id);
                            restoredFolders++;
                            pending.splice(i, 1);
                            i--;
                            progressed = true;
                        } catch {
                            // ignore, next round may succeed after parent restored
                        }
                    }

                    if (!progressed) stalledRounds++;
                    else stalledRounds = 0;
                }
            }

            let movedOk = 0;
            let movedFailed = 0;

            // Reverse moves (in reverse order)
            for (const move of [...op.moves].reverse()) {
                try {
                    const restoreParentId = restoredFolderMap.get(move.fromParentId) || move.fromParentId;
                    await bm.move(move.bookmarkId, restoreParentId, move.fromIndex);
                    movedOk++;
                } catch {
                    movedFailed++;
                }
            }

            let foldersRemoved = 0;
            // Delete created folders (if now empty)
            for (const folderId of op.foldersCreated) {
                try {
                    const children = await bm.getChildren(folderId);
                    if (children.length === 0) {
                        await bm.remove(folderId);
                        foldersRemoved++;
                    }
                } catch {
                    /* folder may already be deleted */
                }
            }
            await callBackground({ type: 'DELETE_OPERATION', operationId: op.id });
            setOperations(prev => prev.filter(o => o.id !== op.id));
            const msg = `${t('rolledBack') || '已回滚'}（${movedOk}/${op.moves.length}${movedFailed ? `，失败 ${movedFailed}` : ''}${restoredFolders ? `，恢复文件夹 ${restoredFolders}` : ''}，移除文件夹 ${foldersRemoved}）`;
            showToast(msg, movedFailed ? 'warning' : 'success');
            load({ silent: true });
        } catch (err) {
            showToast(`❌ ${(err as Error).message}`, 'error');
        } finally {
            setRollingBack(false);
        }
    };

    const folderOptions = collectFolders(bookmarks as unknown as BookmarkNode[], t);

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

                    {(classifyLoading || classifyLogs.length > 0) && (
                        <details className="ai-log card" open>
                            <summary className="ai-log-summary">
                                🧾 {t('aiLog') || '分类日志'} {classifyOpId ? <span className="ai-hint">({classifyOpId.slice(0, 6)})</span> : null}
                            </summary>
                            <div className="ai-log-actions">
                                <button className="btn btn-sm" onClick={copyClassifyLogs} disabled={classifyLogs.length === 0}>
                                    📋 {t('copyLog') || '复制日志'}
                                </button>
                                <button className="btn btn-sm" onClick={() => setClassifyLogs([])} disabled={classifyLogs.length === 0}>
                                    🧹 {t('clearLog') || '清空'}
                                </button>
                            </div>
                            <pre className="ai-log-pre">{classifyLogs.join('\n')}</pre>
                        </details>
                    )}

                    {/* Results (editable) */}
                    {classifyResults.length > 0 && (
                        <div className="classify-results">
                            <div className="classify-results-header">
                                <h3>📋 {t('results') || '分类结果'}（可编辑）</h3>
                                <button className="btn btn-primary" onClick={prepareApply} disabled={applying || prechecking}>
                                    {prechecking ? '⏳ 预检中...' : '✅ 预检并应用'}
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
                                        {classifyResults.length > 1 && (
                                            <button className="btn btn-sm" onClick={() => openMergeModal(catIdx)} title={t('merge') || '合并分类'}>🔀</button>
                                        )}
                                        <button className="btn btn-sm btn-danger" onClick={() => deleteCategory(catIdx)} title={t('delete') || '删除分类'}>✕</button>
                                    </div>
                                    {cat.reason && (
                                        <div className="classify-category-reason">
                                            {cat.reason}
                                        </div>
                                    )}
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
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                    {formatTime(op.timestamp)} · {op.moves.length} 项移动{op.prunedFolders?.length ? ` · 清理空文件夹 ${op.prunedFolders.length}` : ''}
                                </div>
                                <button className="btn btn-sm" onClick={() => rollback(op)} disabled={rollingBack}>
                                    ↩️ {t('rollback') || '回滚'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </Modal>

            {/* Apply precheck modal */}
            <Modal
                open={precheckOpen}
                onClose={() => setPrecheckOpen(false)}
                title={t('precheck') || '应用前预检'}
                width="720px"
                footer={
                    <>
                        <button className="btn" onClick={() => setPrecheckOpen(false)} disabled={applying}>
                            {t('cancel') || '取消'}
                        </button>
                        <button className="btn btn-primary" onClick={applyFromPlan} disabled={applying || applyPlan.length === 0}>
                            {applying ? '⏳ 应用中...' : (t('apply') || '开始应用')}
                        </button>
                    </>
                }
            >
                {applyPlan.length === 0 ? (
                    <p className="ai-hint">{t('noResults') || '无匹配结果'}</p>
                ) : (
                    <div className="apply-plan">
                        <div className="apply-plan-summary ai-hint">
                            {t('found') || '发现'} {applyPlan.length} {t('categories') || '个分类'} · {applyPlan.filter(p => p.existingCandidates.length > 0).length} {t('existing') || '个已存在'} · {applyPlan.filter(p => p.action === 'create').length} {t('toCreate') || '个将创建'}
                        </div>
                        {applyPlan.map((p) => (
                            <div key={p.id} className="apply-plan-item card">
                                {(() => {
                                    const hasCandidates = p.existingCandidates.length > 0;
                                    const selected = p.existingFolderId ? p.existingCandidates.find(c => c.id === p.existingFolderId) : null;
                                    return (
                                        <>
                                            <div className="apply-plan-item-head">
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <strong>{p.categoryName}</strong>
                                                    <span className="badge badge-info">{p.bookmarkIds.length}</span>
                                                </div>
                                                {hasCandidates ? (
                                                    <span className="badge badge-warning">
                                                        {t('folderExists') || '已存在同名文件夹'}
                                                        {p.existingCandidates.length > 1 ? ` ×${p.existingCandidates.length}` : ''}
                                                    </span>
                                                ) : (
                                                    <span className="badge badge-success">{t('folderWillCreate') || '将创建文件夹'}</span>
                                                )}
                                            </div>

                                            {hasCandidates && (
                                                <div className="apply-plan-actions">
                                                    <label className="apply-plan-radio">
                                                        <input
                                                            type="radio"
                                                            name={`apply-action-${p.id}`}
                                                            checked={p.action === 'reuse'}
                                                            onChange={() => updatePlanAction(p.id, 'reuse')}
                                                        />
                                                        {t('reuseExisting') || '复用已有文件夹'}
                                                    </label>
                                                    <label className="apply-plan-radio">
                                                        <input
                                                            type="radio"
                                                            name={`apply-action-${p.id}`}
                                                            checked={p.action === 'create'}
                                                            onChange={() => updatePlanAction(p.id, 'create')}
                                                        />
                                                        {t('createNew') || '创建新文件夹'}
                                                    </label>
                                                </div>
                                            )}

                                            {p.action === 'reuse' && hasCandidates && (
                                                <div style={{ marginTop: 8 }}>
                                                    {p.existingCandidates.length === 1 ? (
                                                        <div className="ai-hint">
                                                            {t('reuseFolder') || '将复用'}: <strong>{p.existingCandidates[0].path}</strong>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <select
                                                                value={p.existingFolderId || ''}
                                                                onChange={(e) => updatePlanExistingFolder(p.id, e.target.value ? String(e.target.value) : null)}
                                                                style={{ width: '100%' }}
                                                            >
                                                                <option value="">{t('selectFolder') || '请选择要复用的文件夹（按路径区分）'}</option>
                                                                {p.existingCandidates.map((c) => (
                                                                    <option key={c.id} value={c.id}>{c.path}</option>
                                                                ))}
                                                            </select>
                                                            {!p.existingFolderId && (
                                                                <div className="ai-hint" style={{ marginTop: 6 }}>
                                                                    {t('selectFolderHint') || '提示：存在多个同名文件夹时，必须选择一个要复用的目标。'}
                                                                </div>
                                                            )}
                                                            {selected && (
                                                                <div className="ai-hint" style={{ marginTop: 6 }}>
                                                                    {t('selected') || '已选择'}: <strong>{selected.path}</strong>
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            )}

                                            {p.action === 'create' && (
                                                <div style={{ marginTop: 8 }}>
                                                    <input
                                                        type="text"
                                                        value={p.createTitle}
                                                        onChange={(e) => updatePlanCreateTitle(p.id, e.target.value)}
                                                        placeholder={t('folderName') || '文件夹名称'}
                                                        style={{ width: '100%' }}
                                                    />
                                                    {hasCandidates && normalizeCategoryName(p.createTitle) === normalizeCategoryName(p.categoryName) && (
                                                        <div className="ai-hint" style={{ marginTop: 6 }}>
                                                            {t('nameConflictHint') || '提示：同名文件夹已存在，建议修改名称以便区分。'}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        ))}
                    </div>
                )}
            </Modal>

            {/* Merge modal */}
            <Modal
                open={mergeOpen}
                onClose={() => setMergeOpen(false)}
                title={t('merge') || '合并分类'}
                footer={
                    <>
                        <button className="btn" onClick={() => setMergeOpen(false)}>
                            {t('cancel') || '取消'}
                        </button>
                        <button className="btn btn-primary" onClick={handleMergeConfirm} disabled={mergeFromIdx === null || mergeToIdx === null}>
                            {t('merge') || '合并'}
                        </button>
                    </>
                }
            >
                {mergeFromIdx === null ? null : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div className="ai-hint">
                            {t('mergeFrom') || '将此分类合并到'}: <strong>{classifyResults[mergeFromIdx]?.category}</strong>
                        </div>
                        <select value={mergeToIdx ?? ''} onChange={(e) => setMergeToIdx(Number(e.target.value))}>
                            {classifyResults.map((c, idx) => (
                                idx === mergeFromIdx ? null : (
                                    <option key={idx} value={idx}>{c.category}</option>
                                )
                            ))}
                        </select>
                    </div>
                )}
            </Modal>

            <ToastContainer toasts={toasts} />
        </div>
    );
}

// Helper
interface FolderOption { id: string; title: string; depth: number }
type TFn = (key: string, substitutions?: string | string[]) => string;
function collectFolders(nodes: BookmarkNode[], t: TFn, depth = 0): FolderOption[] {
    const result: FolderOption[] = [];
    for (const node of nodes) {
        if (!node.url) {
            result.push({ id: node.id, title: node.title || t('untitled'), depth });
            if (node.children) result.push(...collectFolders(node.children, t, depth + 1));
        }
    }
    return result;
}
