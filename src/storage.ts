import { validateKit, type Kit } from "./model";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("drumbo-local", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("kits", { keyPath: "name" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveKit(kit: Kit) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("kits", "readwrite");
      tx.objectStore("kits").put(validateKit(kit));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function kits(): Promise<Kit[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("kits");
      const r = tx.objectStore("kits").getAll();
      r.onsuccess = () => resolve(r.result.map(validateKit));
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
