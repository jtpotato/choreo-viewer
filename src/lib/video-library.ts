export interface SavedVideo {
  id: string;
  name: string;
  size: number;
  modifiedAt: number;
  lastOpenedAt: number;
  handle?: FileSystemFileHandle;
}

const DATABASE_NAME = "choreo-viewer-library";
const STORE_NAME = "videos";

export async function listSavedVideos(): Promise<SavedVideo[]> {
  const database = await openDatabase();
  const records = await requestResult<SavedVideo[]>(database.transaction(STORE_NAME).objectStore(STORE_NAME).getAll());
  database.close();
  return records.sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
}

export async function saveVideo(entry: SavedVideo): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(entry);
  await transactionDone(transaction);
  database.close();
}

export async function removeSavedVideo(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).delete(id);
  await transactionDone(transaction);
  database.close();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the video library."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not read the video library."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the video library."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The video library update was cancelled."));
  });
}
