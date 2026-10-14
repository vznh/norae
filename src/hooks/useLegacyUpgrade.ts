import { useEffect, useState } from 'react';
import type { NoraeAPI } from '../types';

export function useLegacyUpgrade(api: NoraeAPI | undefined) {
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!api || !import.meta.env.DEV) return;
    const controller = new AbortController(); let activated = false;
    const run = async () => {
      const response = await fetch('/__norae-upgrade', { signal: controller.signal });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
      const upgrade = await response.json();
      if (!upgrade.token) return;
      activated = true; setMessage('Saving your songs before restarting…');
      while (!controller.signal.aborted) {
        const tracks = await api.snapshot();
        if (tracks.some(track => ['queued', 'processing'].includes(track.status) || track.export.state === 'running' || Object.values(track.steps).some(step => step.state === 'running'))) {
          setMessage('Waiting for current processing to finish. Your songs will be kept.');
          await new Promise(resolve => setTimeout(resolve, 500)); continue;
        }
        const saved = await fetch('/__norae-upgrade', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Norae-Upgrade': upgrade.token }, body: JSON.stringify(tracks), signal: controller.signal });
        const result = await saved.json();
        if (!saved.ok || result.phase === 'error') throw new Error(result.error || 'The queue could not be saved.');
        if (result.phase !== 'saved') { await new Promise(resolve => setTimeout(resolve, 500)); continue; }
        setMessage('Songs and timing saved. Restarting with the playback fix…'); return;
      }
    };
    void run().catch(error => { if (!controller.signal.aborted && activated) setMessage(`The upgrade could not save your songs. Keep this app open. ${error.message}`); });
    return () => controller.abort();
  }, [api]);
  return message;
}
