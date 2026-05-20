import { getClientId } from "./auth";
import type { DriveToken } from "../types";

declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

let pickerLoaded: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      res();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}

async function ensurePicker(): Promise<void> {
  if (pickerLoaded) return pickerLoaded;
  pickerLoaded = (async () => {
    await loadScript("https://apis.google.com/js/api.js");
    await new Promise<void>((r) => window.gapi.load("picker", r));
  })();
  return pickerLoaded;
}

export interface PickedFolder {
  id: string;
  name: string;
}

export async function pickFolder(t: DriveToken): Promise<PickedFolder | null> {
  await ensurePicker();
  return new Promise((resolve) => {
    const view = new window.google.picker.DocsView(
      window.google.picker.ViewId.FOLDERS,
    )
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes("application/vnd.google-apps.folder");

    const picker = new window.google.picker.PickerBuilder()
      .setOAuthToken(t.access)
      .setAppId(getClientId().split("-")[0])
      .addView(view)
      .setCallback((data: any) => {
        const action = data[window.google.picker.Response.ACTION];
        if (action === window.google.picker.Action.PICKED) {
          const docs = data[window.google.picker.Response.DOCUMENTS];
          const doc = docs && docs[0];
          if (doc) {
            resolve({ id: doc.id, name: doc.name });
          } else {
            resolve(null);
          }
        } else if (action === window.google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
