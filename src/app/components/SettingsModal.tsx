"use client";
import React, { useEffect, useMemo, useState } from "react";
import { parseMcpConfigToHostedServers } from "@/app/lib/mcpConfig";

type Props = {
  open: boolean;
  onClose: () => void;
  isAudioPlaybackEnabled: boolean;
  setIsAudioPlaybackEnabled: (val: boolean) => void;
  isEventsPaneExpanded: boolean;
  setIsEventsPaneExpanded: (val: boolean) => void;
  codec: string;
  onCodecChange: (newCodec: string) => void;
};

export default function SettingsModal({ open, onClose, isAudioPlaybackEnabled, setIsAudioPlaybackEnabled, isEventsPaneExpanded, setIsEventsPaneExpanded, codec, onCodecChange }: Props) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    const saved = window.localStorage.getItem('theme');
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return (saved ? (saved as 'light' | 'dark') : (prefersDark ? 'dark' : 'light'));
  });
  const [mcpJson, setMcpJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validServersPreview, setValidServersPreview] = useState<string>("");
  const [localCodec, setLocalCodec] = useState<string>(codec || 'opus');
  const [localShowLogs, setLocalShowLogs] = useState<boolean>(isEventsPaneExpanded);

  useEffect(() => {
    if (!open) return;
    const savedJson = window.localStorage.getItem('mcpConfig') || '';
    setMcpJson(savedJson);
    setError(null);
    setValidServersPreview("");
    setLocalCodec(codec || 'opus');
    setLocalShowLogs(isEventsPaneExpanded);
  }, [open]);

  useEffect(() => {
    // Apply theme immediately when switching
    if (!open) return;
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
  }, [theme, open]);

  const validate = () => {
    try {
      const servers = parseMcpConfigToHostedServers(mcpJson);
      if (!servers.length) throw new Error('No servers found in config');
      setValidServersPreview(JSON.stringify(servers, null, 2));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Invalid JSON');
      setValidServersPreview("");
    }
  };

  const save = () => {
    try {
      // Validate before saving
      parseMcpConfigToHostedServers(mcpJson);
      window.localStorage.setItem('mcpConfig', mcpJson);
      window.localStorage.setItem('theme', theme);
      window.localStorage.setItem('codec', localCodec);
      if (localCodec !== codec) {
        onCodecChange(localCodec);
      }
      setIsEventsPaneExpanded(localShowLogs);
      setError(null);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Invalid JSON');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-4xl bg-white dark:bg-neutral-900 rounded-xl shadow-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <div className="font-semibold">Settings</div>
          <button onClick={onClose} className="text-gray-600 dark:text-gray-300 hover:opacity-80">✕</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
          <div className="md:border-r border-neutral-200 dark:border-neutral-800 p-4 space-y-6">
            <div>
              <div className="text-sm font-medium mb-2">Appearance</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTheme('light')}
                  className={`px-3 py-1 rounded-md border ${theme==='light' ? 'bg-gray-100 dark:bg-neutral-800' : ''}`}
                >Light</button>
                <button
                  onClick={() => setTheme('dark')}
                  className={`px-3 py-1 rounded-md border ${theme==='dark' ? 'bg-gray-100 dark:bg-neutral-800' : ''}`}
                >Dark</button>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-2">Audio Playback</div>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isAudioPlaybackEnabled}
                  onChange={(e) => setIsAudioPlaybackEnabled(e.target.checked)}
                />
                <span>Enable audio playback</span>
              </label>
            </div>

            <div>
              <div className="text-sm font-medium mb-2">Logs</div>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={localShowLogs}
                  onChange={(e) => setLocalShowLogs(e.target.checked)}
                />
                <span>Show logs panel</span>
              </label>
            </div>

            <div>
              <div className="text-sm font-medium mb-2">Codec</div>
              <select
                className="border rounded px-2 py-1 bg-transparent"
                value={localCodec}
                onChange={(e) => setLocalCodec(e.target.value)}
              >
                <option value="opus">Opus (48 kHz)</option>
                <option value="pcmu">PCMU (8 kHz)</option>
                <option value="pcma">PCMA (8 kHz)</option>
              </select>
            </div>
          </div>

          <div className="md:col-span-2 p-4">
            <div className="text-sm font-medium mb-2">Remote MCP Configuration</div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Paste your Claude-style MCP JSON. Example includes a single hosted server.</p>
            <textarea
              value={mcpJson}
              onChange={(e) => setMcpJson(e.target.value)}
              rows={12}
              className="w-full border rounded-md p-2 font-mono text-sm bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700"
              placeholder='{"mcpServers": {"GramAcmetodo": {"command": "npx", "args": ["mcp-remote", "https://app.getgram.ai/mcp/ritza-rzx-acmetodo-demo"]}}}'
            />

            {error && <div className="text-sm text-red-500 mt-2">{error}</div>}
            {validServersPreview && (
              <div className="mt-3">
                <div className="text-xs mb-1 text-gray-600 dark:text-gray-400">Detected servers</div>
                <pre className="max-h-40 overflow-auto bg-gray-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded p-2 text-xs">{validServersPreview}</pre>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-neutral-200 dark:border-neutral-800">
          <button onClick={validate} className="border rounded-md px-3 py-1 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800">Validate</button>
          <button onClick={save} className="bg-black text-white rounded-md px-3 py-1 text-sm hover:bg-gray-900">Save</button>
        </div>
      </div>
    </div>
  );
}
