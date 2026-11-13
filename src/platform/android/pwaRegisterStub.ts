import { useState } from 'react';

// The Android bundle has no service worker. ReloadPrompt is not rendered there,
// but the module must still resolve for the shared import graph.
export function useRegisterSW() {
  const offlineReady = useState(false);
  const needRefresh = useState(false);
  return {
    offlineReady,
    needRefresh,
    updateServiceWorker: async () => {},
  };
}
