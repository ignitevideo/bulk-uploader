import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios, { AxiosError } from 'axios';
import './App.css';

type UploadStage =
  | 'pending'
  | 'creating'
  | 'uploading'
  | 'uploaded'
  | 'polling'
  | 'done'
  | 'error';

type UploadItem = {
  id: string;
  file: File;
  title: string;
  progressPercent: number; // 0-100
  stage: UploadStage;
  statusText: string;
  videoId?: string;
  errorMessage?: string;
};

const DEFAULT_API_BASE = 'https://app.ignitevideo.cloud/api';
const MAX_FILES = 10;

function App() {
  const [token, setToken] = useState<string>('');
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const pollTimersRef = useRef<Map<string, number>>(new Map());
  const [warning, setWarning] = useState<string>('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [apiBase, setApiBase] = useState<string>(DEFAULT_API_BASE);

  // Load token from localStorage once
  useEffect(() => {
    const stored = localStorage.getItem('ignite_token');
    if (stored) setToken(stored);
    const storedBase = localStorage.getItem('ignite_api_base');
    if (storedBase) setApiBase(storedBase);
  }, []);

  // Persist token
  useEffect(() => {
    if (token) {
      localStorage.setItem('ignite_token', token);
    }
  }, [token]);

  // Persist API base
  useEffect(() => {
    if (apiBase) {
      localStorage.setItem('ignite_api_base', apiBase);
    }
  }, [apiBase]);

  const apiBaseSanitized = useMemo(() => apiBase.replace(/\/$/, ''), [apiBase]);

  // Build UploadItem list when files change
  useEffect(() => {
    const newItems: UploadItem[] = files.map((file, idx) => ({
      id: `${Date.now()}-${idx}-${file.name}`,
      file,
      title: file.name,
      progressPercent: 0,
      stage: 'pending',
      statusText: 'Pending',
    }));
    setItems(newItems);
  }, [files]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      pollTimersRef.current.forEach((timerId) => window.clearInterval(timerId));
      pollTimersRef.current.clear();
    };
  }, []);

  const canUpload = useMemo(
    () => token.trim().length > 0 && items.length > 0 && !isUploading,
    [token, items.length, isUploading]
  );

  const handleFilesSelected: React.ChangeEventHandler<HTMLInputElement> = (
    e
  ) => {
    const list = e.target.files;
    if (!list) return;
    const all = Array.from(list);
    if (all.length > MAX_FILES) {
      setWarning(
        `You selected ${all.length} files. Only the first ${MAX_FILES} will be used.`
      );
    } else {
      setWarning('');
    }
    const selected = all.slice(0, MAX_FILES);
    setFiles(selected);
  };

  const updateItem = (
    id: string,
    updater: (prev: UploadItem) => UploadItem
  ) => {
    setItems((prev) => prev.map((it) => (it.id === id ? updater(it) : it)));
  };

  const createVideo = async (item: UploadItem) => {
    const url = `${apiBaseSanitized}/videos/upload`;
    const payload = {
      title: item.title,
      visibility,
    } as const;
    const res = await axios.put(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    return res.data as { videoId: string; title: string; signedUrl: string };
  };

  const uploadToSignedUrl = async (item: UploadItem, signedUrl: string) => {
    const contentType = item.file.type || 'application/octet-stream';
    await axios.put(signedUrl, item.file, {
      headers: { 'Content-Type': contentType },
      onUploadProgress: (evt) => {
        if (!evt.total) return;
        const percent = Math.round((evt.loaded / evt.total) * 100);
        updateItem(item.id, (prev) => ({ ...prev, progressPercent: percent }));
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      withCredentials: false,
    });
  };

  const pollVideoStatus = (itemId: string, videoId: string) => {
    const intervalMs = 10000; // 10s

    // Clear existing if any
    const existing = pollTimersRef.current.get(itemId);
    if (existing) window.clearInterval(existing);

    const run = async () => {
      try {
        const res = await axios.get(`${apiBaseSanitized}/videos/${videoId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = res.data as any;
        const status: string = (
          data.status ||
          data.encodingStatus ||
          ''
        ).toString();
        const normalized = status || 'processing';
        updateItem(itemId, (prev) => ({ ...prev, statusText: normalized }));

        const doneStatuses = [
          'encoded',
          'ready',
          'finished',
          'complete',
          'completed',
        ];
        const errorStatuses = ['failed', 'error'];
        if (doneStatuses.includes(normalized.toLowerCase())) {
          // done
          updateItem(itemId, (prev) => ({ ...prev, stage: 'done' }));
          const t = pollTimersRef.current.get(itemId);
          if (t) window.clearInterval(t);
          pollTimersRef.current.delete(itemId);
        } else if (errorStatuses.includes(normalized.toLowerCase())) {
          updateItem(itemId, (prev) => ({
            ...prev,
            stage: 'error',
            errorMessage: `Encoding ${normalized}`,
          }));
          const t = pollTimersRef.current.get(itemId);
          if (t) window.clearInterval(t);
          pollTimersRef.current.delete(itemId);
        }
      } catch (err) {
        const message = extractAxiosError(err);
        updateItem(itemId, (prev) => ({
          ...prev,
          statusText: `Poll error: ${message}`,
        }));
      }
    };

    // Run immediately then every interval
    run();
    const timerId = window.setInterval(run, intervalMs);
    pollTimersRef.current.set(itemId, timerId);
  };

  const startUploads = async () => {
    if (!canUpload) return;
    setIsUploading(true);
    try {
      await Promise.all(
        items.map(async (item) => {
          try {
            updateItem(item.id, (prev) => ({
              ...prev,
              stage: 'creating',
              statusText: 'Creating video…',
            }));
            const { videoId, signedUrl } = await createVideo(item);
            updateItem(item.id, (prev) => ({
              ...prev,
              videoId,
              stage: 'uploading',
              statusText: 'Uploading…',
            }));

            await uploadToSignedUrl({ ...item, videoId }, signedUrl);
            updateItem(item.id, (prev) => ({
              ...prev,
              stage: 'uploaded',
              statusText: 'Uploaded. Starting to poll…',
              progressPercent: 100,
            }));

            updateItem(item.id, (prev) => ({ ...prev, stage: 'polling' }));
            pollVideoStatus(item.id, videoId);
          } catch (err) {
            const message = extractAxiosError(err);
            updateItem(item.id, (prev) => ({
              ...prev,
              stage: 'error',
              errorMessage: message,
              statusText: 'Error',
            }));
          }
        })
      );
    } finally {
      setIsUploading(false);
    }
  };

  const clearAll = () => {
    pollTimersRef.current.forEach((t) => window.clearInterval(t));
    pollTimersRef.current.clear();
    setFiles([]);
    setItems([]);
  };

  const extractAxiosError = (error: unknown): string => {
    const err = error as AxiosError<any>;
    if (err.response) {
      const status = err.response.status;
      const data = err.response.data as any;
      const msg =
        (data && (data.message || data.error || JSON.stringify(data))) ||
        'Request failed';
      return `${status}: ${msg}`;
    }
    if (err.request) {
      return 'No response from server';
    }
    return err.message || 'Unknown error';
  };

  return (
    <div className="uploader-root">
      <h1>Ignite Video Bulk Uploader</h1>

      <div className="token-row">
        <label htmlFor="token">API Token</label>
        <input
          id="token"
          type="password"
          placeholder="Paste your Bearer token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="api-base-row">
        <label htmlFor="api-base">API Base</label>
        <input
          id="api-base"
          type="text"
          placeholder="https://app.ignitevideo.cloud/api"
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
        />
      </div>

      <div className="visibility-row">
        <label htmlFor="visibility">Visibility</label>
        <select
          id="visibility"
          value={visibility}
          onChange={(e) =>
            setVisibility(e.target.value as 'private' | 'public')
          }
        >
          <option value="private">Private</option>
          <option value="public">Public</option>
        </select>
      </div>

      <div className="picker-row">
        <input
          id="file-picker"
          type="file"
          accept="video/*"
          multiple
          onChange={handleFilesSelected}
        />
        <span className="hint">Select up to 10 video files</span>
        {warning && <span className="warning">{warning}</span>}
      </div>

      <div className="actions">
        <button onClick={startUploads} disabled={!canUpload}>
          {isUploading ? 'Uploading…' : 'Upload All'}
        </button>
        <button onClick={clearAll} disabled={items.length === 0}>
          Clear
        </button>
      </div>

      {items.length > 0 && (
        <div className="list">
          {items.map((it) => (
            <div className="item" key={it.id}>
              <div className="item-header">
                <div className="title" title={it.title}>
                  {it.title}
                </div>
                <div className={`stage stage-${it.stage}`}>{it.statusText}</div>
              </div>
              <div className="progress-row">
                <div className="progress">
                  <div
                    className="bar"
                    style={{ width: `${it.progressPercent}%` }}
                  />
                </div>
                <div className="percent">{it.progressPercent}%</div>
              </div>
              <div className="meta">
                {it.videoId && (
                  <span className="video-id">ID: {it.videoId}</span>
                )}
                {it.errorMessage && (
                  <span className="error">{it.errorMessage}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <footer className="footer">
        <a
          href="https://docs.ignite.video/api-reference/videos/create"
          target="_blank"
          rel="noreferrer"
        >
          API docs
        </a>
      </footer>
    </div>
  );
}

export default App;
