import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Slice 11: container-mode Card on the Edit Space page. Controlled by
// the parent form — toggle + dockerfile content are part of FormState,
// the page's main Save commits everything (regular fields + dockerfile +
// runtime-mode flip) in one user action.

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

type DetectResult = {
  content: string;
  detectedFrom: string | null;
  warnings: string[];
};

export function ContainerIsolationCard({
  spaceId,
  enabled,
  content,
  onEnabledChange,
  onContentChange,
}: {
  spaceId: string;
  enabled: boolean;
  content: string;
  onEnabledChange: (next: boolean) => void;
  onContentChange: (next: string) => void;
}): React.ReactElement {
  const [detecting, setDetecting] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [detectedFrom, setDetectedFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onDetect(): Promise<void> {
    setDetecting(true);
    setError(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/dockerfile/detect`, {
        method: 'POST',
      });
      const data = (await res.json().catch(() => ({}))) as
        | DetectResult
        | { error?: string };
      if (!res.ok) {
        setError((data as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      const det = data as DetectResult;
      // Always overwrite — the button's job is "replace whatever's in the
      // textarea with the freshly-detected Dockerfile." If detection
      // didn't find a real Dockerfile, the generator still returns a
      // skeleton + a warning explaining what happened; the warnings
      // panel surfaces that to the user.
      onContentChange(det.content);
      setWarnings(det.warnings);
      setDetectedFrom(det.detectedFrom);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetecting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Container isolation (optional)</span>
          <Toggle enabled={enabled} onChange={onEnabledChange} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-xs">
          When ON, the agent runs inside a Docker container built from the Dockerfile
          below (a per-Space copy with the Sandcastle agent layer appended). When OFF,
          the agent runs directly on the host.
        </p>

        {enabled && (
          <>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onDetect}
                disabled={detecting}
              >
                {detecting ? 'Detecting…' : 'Detect Dockerfile'}
              </Button>
              {detectedFrom && (
                <span className="text-muted-foreground text-xs">
                  Loaded from <code className="font-mono">{detectedFrom}</code>.
                </span>
              )}
            </div>

            {warnings.length > 0 && (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950">
                <div className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {warnings.length === 1
                    ? '1 warning from the generator'
                    : `${warnings.length} warnings from the generator`}
                </div>
                <ul className="ml-1 space-y-1 text-amber-700 dark:text-amber-400">
                  {warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}

            {error && <p className="text-destructive text-xs">{error}</p>}

            <textarea
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              className={`${inputClass} h-96 font-mono text-xs`}
              spellCheck={false}
              placeholder="# Paste a Dockerfile or click Detect to load one from the repo"
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Exported so EditSpacePage can reuse the same toggle for the Private
// packages Card — both Cards behave identically: toggle gates whether
// the body fields are submitted at all.
export function Toggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
        enabled ? 'bg-emerald-600' : 'bg-input'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
