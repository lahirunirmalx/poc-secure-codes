"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { QRCodeSVG } from "qrcode.react";

const QrScanner = dynamic(
  () => import("@yudiel/react-qr-scanner").then((mod) => mod.Scanner),
  { ssr: false }
);

type ConsumeVia = "scan" | "manual" | "main-selection";
type KeyType = "main" | "sub";

interface SubKeyRecord {
  id: string;
  key: string;
  consumed: boolean;
  revoked?: boolean;
  generation?: number;
  consumedAt?: string | null;
  consumedVia?: string | null;
  revokedAt?: string | null;
  revokedReason?: string | null;
}

interface ResolveResult {
  type: KeyType;
  mainId: string;
  consumed?: boolean;
  revoked?: boolean;
  generation?: number;
}

export default function Home() {
  const [mainId, setMainId] = useState("");
  const [mainLongKey, setMainLongKey] = useState("");
  const [mainShortKey, setMainShortKey] = useState("");
  const [subKeys, setSubKeys] = useState<SubKeyRecord[]>([]);
  const [inputKey, setInputKey] = useState("");
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastResolve, setLastResolve] = useState<ResolveResult | null>(null);

  const availableSubKeys = useMemo(
    () => subKeys.filter((item) => !item.consumed && !item.revoked),
    [subKeys]
  );

  async function generateKeys(): Promise<void> {
    setBusy(true);
    setStatus("Generating keys...");
    try {
      const response = await fetch("/api/keys/generate", { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to generate keys");
      }
      setMainId(data.main.id);
      setMainLongKey(data.main.longKey);
      setMainShortKey(data.main.shortKey);
      setSubKeys(data.subKeys);
      setLastResolve(null);
      setStatus("Generated 1 main key and 10 sub keys.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadMainSubKeys(targetMainId: string): Promise<void> {
    const response = await fetch(`/api/keys/main/${targetMainId}/subkeys`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error ?? "Failed to load sub keys");
    }
    setMainId(data.mainId);
    setMainShortKey(data.mainShortKey);
    setSubKeys(data.subKeys);
  }

  async function resolveKey(key: string): Promise<ResolveResult> {
    const response = await fetch("/api/keys/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error ?? "Resolve failed");
    }
    return data as ResolveResult;
  }

  async function consumeSubKey(key: string, via: ConsumeVia): Promise<void> {
    const response = await fetch("/api/keys/consume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, via }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error ?? "Consume failed");
    }
  }

  async function handleResolveAndAct(rawKey: string, via: ConsumeVia): Promise<void> {
    const trimmed = rawKey.trim();
    if (!trimmed) {
      setStatus("Please provide a key first.");
      return;
    }

    setBusy(true);
    setStatus("Resolving key...");
    try {
      const resolved = await resolveKey(trimmed);
      setLastResolve(resolved);

      if (resolved.type === "main") {
        await loadMainSubKeys(resolved.mainId);
        setStatus("Main key detected. Pick a sub key to consume.");
      } else {
        await consumeSubKey(trimmed, via);
        await loadMainSubKeys(resolved.mainId);
        setStatus("Sub key consumed successfully.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function consumeSelectedSubKey(key: string): Promise<void> {
    setBusy(true);
    setStatus("Consuming selected sub key...");
    try {
      await consumeSubKey(key, "main-selection");
      if (mainId) {
        await loadMainSubKeys(mainId);
      }
      setStatus("Selected sub key consumed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Consume failed");
    } finally {
      setBusy(false);
    }
  }

  async function issueSubKeys(
    strategy: "append" | "replace",
    count: number,
    reason?: string
  ): Promise<void> {
    if (!mainId) {
      setStatus("Generate or resolve a main key first.");
      return;
    }

    setBusy(true);
    setStatus(
      strategy === "replace"
        ? "Revoking active sub keys and issuing a new set..."
        : "Issuing additional sub keys..."
    );

    try {
      const response = await fetch(`/api/keys/main/${mainId}/subkeys/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy, count, reason }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Issue sub keys failed");
      }

      await loadMainSubKeys(mainId);
      setStatus(
        strategy === "replace"
          ? `Issued ${data.issuedCount} new sub keys and revoked old active keys.`
          : `Issued ${data.issuedCount} new sub keys.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Issue sub keys failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <main className="mx-auto w-full max-w-md space-y-4 p-4 sm:max-w-2xl">
        <section className="rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-900">
          <h1 className="text-xl font-bold">Main/Sub Key POC</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Generate a shareable main key and 10 one-time sub keys. Scan or type
            any key to resolve and consume.
          </p>
          <button
            type="button"
            onClick={generateKeys}
            disabled={busy}
            className="mt-3 w-full rounded-lg bg-black px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {busy ? "Working..." : "Generate Main + 10 Sub Keys"}
          </button>
          <p className="mt-2 text-sm">{status}</p>
        </section>

        {mainLongKey ? (
          <section className="rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-900">
            <h2 className="font-semibold">Main Key (Long)</h2>
            <p className="mt-2 break-all rounded-md bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
              {mainLongKey}
            </p>
            <div className="mt-3 flex justify-center rounded-lg bg-white p-3">
              <QRCodeSVG value={mainLongKey} size={180} />
            </div>
            {mainShortKey ? (
              <>
                <h3 className="mt-4 font-semibold">Main Key (Short)</h3>
                <p className="mt-2 break-all rounded-md bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
                  {mainShortKey}
                </p>
                <div className="mt-3 flex justify-center rounded-lg bg-white p-3">
                  <QRCodeSVG value={mainShortKey} size={140} />
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        <section className="rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-900">
          <h2 className="font-semibold">Scan or Type Key</h2>
          <textarea
            value={inputKey}
            onChange={(event) => setInputKey(event.target.value)}
            rows={3}
            placeholder="Enter main key (long/short) or sub key (6 digits)"
            className="mt-2 w-full rounded-md border border-zinc-300 bg-transparent p-2 text-sm"
          />
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => handleResolveAndAct(inputKey, "manual")}
              disabled={busy}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-black"
            >
              Resolve/Consume
            </button>
            <button
              type="button"
              onClick={() => setScannerOpen((value) => !value)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium"
            >
              {scannerOpen ? "Hide Scanner" : "Open Scanner"}
            </button>
            <button
              type="button"
              onClick={() => {
                setInputKey("");
                setLastResolve(null);
              }}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium"
            >
              Clear
            </button>
          </div>

          {scannerOpen ? (
            <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200">
              <QrScanner
                constraints={{ facingMode: "environment" }}
                onScan={(codes) => {
                  if (codes.length === 0 || busy) {
                    return;
                  }
                  const scanned = codes[0]?.rawValue;
                  if (!scanned) {
                    return;
                  }
                  setInputKey(scanned);
                  setScannerOpen(false);
                  void handleResolveAndAct(scanned, "scan");
                }}
                onError={() => setStatus("Scanner error. Use manual entry.")}
              />
            </div>
          ) : null}
        </section>

        {lastResolve ? (
          <section className="rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-900">
            <h2 className="font-semibold">Last Resolve</h2>
            <p className="mt-1 text-sm">
              Type: <strong>{lastResolve.type}</strong> | Main ID:{" "}
              <span className="break-all">{lastResolve.mainId}</span>
            </p>
          </section>
        ) : null}

        {subKeys.length > 0 ? (
          <section className="rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-900">
            <h2 className="font-semibold">
              Sub Keys ({availableSubKeys.length} available / {subKeys.length})
            </h2>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={busy || !mainId}
                onClick={() => issueSubKeys("append", 5)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
              >
                Issue 5 More
              </button>
              <button
                type="button"
                disabled={busy || !mainId}
                onClick={() => issueSubKeys("replace", 10, "misuse-containment")}
                className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-black disabled:opacity-50"
              >
                Revoke Active + Reissue 10
              </button>
            </div>
            <div className="mt-3 space-y-3">
              {subKeys.map((item, index) => (
                <article
                  key={item.id}
                  className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium">Sub #{index + 1}</p>
                    <span
                      className={`rounded px-2 py-1 text-xs ${
                        item.revoked
                          ? "bg-zinc-300 text-zinc-700"
                          : item.consumed
                            ? "bg-red-100 text-red-700"
                            : "bg-green-100 text-green-700"
                      }`}
                    >
                      {item.revoked ? "Revoked" : item.consumed ? "Consumed" : "Available"}
                    </span>
                  </div>
                  <p className="break-all rounded-md bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
                    {item.key}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">Generation: {item.generation ?? 1}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="rounded bg-white p-2">
                      <QRCodeSVG value={item.key} size={96} />
                    </div>
                    <button
                      type="button"
                      disabled={busy || item.consumed || item.revoked}
                      onClick={() => consumeSelectedSubKey(item.key)}
                      className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-black"
                    >
                      Consume
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
