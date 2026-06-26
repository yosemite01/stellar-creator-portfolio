"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { trackEvent } from "@/lib/analytics/analytics";

interface ApiKeyRecord {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export function ApiKeysManager() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read-only"]);
  const [expiryDays, setExpiryDays] = useState("90");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadKeys = useCallback(async () => {
    const res = await fetch("/api/developer/keys");
    if (res.ok) {
      const data = await res.json();
      setKeys(data.keys);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const toggleScope = (scope: string) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const createKey = async () => {
    const expiresAt =
      expiryDays === "never"
        ? undefined
        : new Date(Date.now() + Number(expiryDays) * 86400000).toISOString();

    const res = await fetch("/api/developer/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, scopes, expiresAt }),
    });

    if (res.ok) {
      const data = await res.json();
      setNewKey(data.rawKey);
      setName("");
      trackEvent("api_key_created", { scopes: scopes.join(",") });
      await loadKeys();
    }
  };

  const revokeKey = async (id: string) => {
    await fetch(`/api/developer/keys/${id}`, { method: "DELETE" });
    trackEvent("api_key_revoked", { id });
    await loadKeys();
  };

  if (loading) {
    return <p className="text-muted-foreground">Loading API keys…</p>;
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Create API key</h2>
        <div className="space-y-2">
          <Label htmlFor="key-name">Name</Label>
          <Input
            id="key-name"
            placeholder="My integration"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Permission scopes</Label>
          <div className="flex gap-4">
            {(["read-only", "read-write"] as const).map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={scopes.includes(scope)}
                  onCheckedChange={() => toggleScope(scope)}
                />
                {scope}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Expiry</Label>
          <Select value={expiryDays} onValueChange={setExpiryDays}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
              <SelectItem value="365">1 year</SelectItem>
              <SelectItem value="never">Never</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={createKey} disabled={!name.trim() || scopes.length === 0}>
          Generate key
        </Button>
        {newKey && (
          <div className="rounded-md bg-muted p-4 space-y-2">
            <p className="text-sm font-medium text-destructive">
              Copy this key now — it will not be shown again.
            </p>
            <code className="block break-all text-sm">{newKey}</code>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Your API keys</h2>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No API keys yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {keys.map((key) => (
              <li key={key.id} className="flex items-center justify-between p-4 gap-4">
                <div>
                  <p className="font-medium">{key.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Scopes: {key.scopes.join(", ")} · Created{" "}
                    {new Date(key.createdAt).toLocaleDateString()}
                    {key.lastUsedAt &&
                      ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                  </p>
                  <div className="mt-2 h-8 w-48 rounded bg-muted/60 flex items-center justify-center text-xs text-muted-foreground">
                    Usage graph (requests/day)
                  </div>
                </div>
                <Button variant="destructive" size="sm" onClick={() => revokeKey(key.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
