import { api, saveBlob } from '../lib/api';

/** Opens (or downloads) a billing PDF: plain links can't carry the session token. */
export async function openBillingPdf(path: string, filename: string, download: boolean) {
  // Open the tab while still inside the click: a window.open after an await is treated as a popup.
  const tab = download ? null : window.open('', '_blank');
  if (tab) tab.opener = null;
  try {
    const blob = await api.blob(path, download ? { download: true } : {});
    if (download) {
      saveBlob(blob, filename);
      return;
    }
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    if (tab) tab.location.href = url;
    else window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}
