import { randomId, now } from '@/lib/utils';
import type { BookmarkSnapshotNode, OperationSnapshot } from '@/types/bookmark';

const OPERATION_HISTORY_KEY = 'bookmarkMap.operationHistory.v1';
const MAX_HISTORY = 20;

interface OperationHistoryStore {
    version: 1;
    snapshots: OperationSnapshot[];
}

function createEmptyStore(): OperationHistoryStore {
    return { version: 1, snapshots: [] };
}

function normalizeStore(raw: unknown): OperationHistoryStore {
    const store = raw as OperationHistoryStore | undefined;
    if (!store || typeof store !== 'object' || store.version !== 1) return createEmptyStore();
    return {
        version: 1,
        snapshots: Array.isArray(store.snapshots) ? store.snapshots : [],
    };
}

export async function readOperationHistory(): Promise<OperationHistoryStore> {
    return new Promise((resolve) => {
        chrome.storage.local.get([OPERATION_HISTORY_KEY], (result) => {
            resolve(normalizeStore(result?.[OPERATION_HISTORY_KEY]));
        });
    });
}

async function writeOperationHistory(store: OperationHistoryStore): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [OPERATION_HISTORY_KEY]: store }, () => resolve());
    });
}

export async function pushOperationSnapshot(
    label: string,
    nodes: BookmarkSnapshotNode[]
): Promise<OperationSnapshot> {
    const snapshot: OperationSnapshot = {
        id: randomId(),
        createdAt: now(),
        label,
        nodes,
    };

    const store = await readOperationHistory();
    const next: OperationHistoryStore = {
        version: 1,
        snapshots: [snapshot, ...store.snapshots].slice(0, MAX_HISTORY),
    };
    await writeOperationHistory(next);
    return snapshot;
}

export async function peekLastOperationSnapshot(): Promise<OperationSnapshot | null> {
    const store = await readOperationHistory();
    return store.snapshots[0] || null;
}

export async function popLastOperationSnapshot(): Promise<OperationSnapshot | null> {
    const store = await readOperationHistory();
    const [first, ...rest] = store.snapshots;
    if (!first) return null;
    await writeOperationHistory({ version: 1, snapshots: rest });
    return first;
}
