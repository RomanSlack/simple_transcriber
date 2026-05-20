import React, { useEffect, useState } from 'react';
import { api } from './api';
import { Onboarding } from './onboarding/Onboarding';
import { Recorder } from './recorder/Recorder';
import { Settings } from './settings/Settings';
import { TranscriptViewer } from './sessions/TranscriptViewer';
import { TitleBar } from './ui/TitleBar';
import type { AppSettings } from '../shared/types';

type Route =
  | { name: 'onboarding' }
  | { name: 'recorder' }
  | { name: 'settings' }
  | { name: 'transcript'; id: string };

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'recorder' });

  useEffect(() => {
    api.settings.get().then((s) => {
      setSettings(s);
      if (!s.onboardingComplete) setRoute({ name: 'onboarding' });
    });
    api.theme.get().then((t) => {
      document.documentElement.setAttribute('data-theme', t.effective);
    });
    const off = api.theme.onChange((t) => {
      document.documentElement.setAttribute('data-theme', t.effective);
    });
    return () => {
      off();
    };
  }, []);

  const refreshSettings = async () => {
    const s = await api.settings.get();
    setSettings(s);
  };

  if (!settings)
    return (
      <div className="app-root">
        <TitleBar />
        <div className="app-body" />
      </div>
    );

  return (
    <div className="app-root">
      <TitleBar />
      <div className="app-body">
      {route.name === 'onboarding' && (
        <Onboarding
          onDone={async () => {
            await api.settings.update({ onboardingComplete: true });
            await refreshSettings();
            setRoute({ name: 'recorder' });
          }}
        />
      )}
      {route.name === 'recorder' && (
        <Recorder
          settings={settings}
          onOpenSettings={() => setRoute({ name: 'settings' })}
          onOpenTranscript={(id) => setRoute({ name: 'transcript', id })}
        />
      )}
      {route.name === 'settings' && (
        <Settings
          settings={settings}
          onClose={async () => {
            await refreshSettings();
            setRoute({ name: 'recorder' });
          }}
        />
      )}
      {route.name === 'transcript' && (
        <TranscriptViewer id={route.id} onBack={() => setRoute({ name: 'recorder' })} />
      )}
      </div>
    </div>
  );
}
