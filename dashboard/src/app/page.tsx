"use client";

import { useEffect, useState } from "react";

type BackendMetrics = {
  requests: number;
  failures: number;
};

type Metrics = {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalDurationMs: number;
  backends: Record<string, BackendMetrics>;
  circuits: Record<string, { state: string }>;
};

const emptyMetrics: Metrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  totalDurationMs: 0,
  backends: {},
  circuits: {},
};

function StatCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string | number;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-xs text-zinc-500">{description}</p>
    </div>
  );
}

function statusColor(state: string) {
  switch (state) {
    case "CLOSED":
      return "bg-emerald-500/10 text-emerald-400";
    case "OPEN":
      return "bg-red-500/10 text-red-400";
    case "HALF_OPEN":
      return "bg-amber-500/10 text-amber-400";
    default:
      return "bg-zinc-800 text-zinc-300";
  }
}

export default function Home() {
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let currentController: AbortController | null = null;

    async function loadMetrics() {
      // Prevent overlapping polling requests.
      if (!active || inFlight) return;

      inFlight = true;
      const controller = new AbortController();
      currentController = controller;

      try {
        const response = await fetch("/api/metrics", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Metrics API returned ${response.status}`);
        }

        const data: Metrics = await response.json();

        if (active) {
          setMetrics(data);
          setError("");
          setLastUpdated(new Date().toLocaleTimeString());
        }
      } catch (err) {
        if (active && !(err instanceof Error && err.name === "AbortError")) {
          setError("Unable to load metrics. Check that the proxy is running.");
        }
      } finally {
        inFlight = false;

        if (currentController === controller) {
          currentController = null;
        }
      }
    }

    void loadMetrics();

    const interval = setInterval(() => {
      void loadMetrics();
    }, 2000);

    return () => {
      active = false;
      clearInterval(interval);
      currentController?.abort();
    };
  }, []);

  const totalCompleted = metrics.successfulRequests + metrics.failedRequests;

  const averageResponseTime =
    totalCompleted > 0 ? metrics.totalDurationMs / totalCompleted : 0;

  const successRate =
    metrics.totalRequests > 0
      ? (metrics.successfulRequests / metrics.totalRequests) * 100
      : 0;

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-8 text-zinc-100 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 border-b border-zinc-800 pb-7 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-xl text-indigo-400">
              N
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">net-flow</h1>
              <p className="text-sm text-zinc-400">
                Load Balancer Observability Dashboard
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                error ? "bg-red-500" : "animate-pulse bg-emerald-400"
              }`}
            />
            <span className={error ? "text-red-400" : "text-emerald-400"}>
              {error ? "Connection issue" : "Polling metrics"}
            </span>
            <span className="text-zinc-500">· 2s</span>
          </div>
        </header>

        {error && (
          <div className="mt-6 rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Request Overview</h2>
            <span className="text-right text-xs text-zinc-500">
              Updated: {lastUpdated ?? "Waiting for data..."}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Total Requests"
              value={metrics.totalRequests}
              description="Requests processed by the proxy"
            />
            <StatCard
              title="Successful Requests"
              value={metrics.successfulRequests}
              description={`${successRate.toFixed(1)}% success rate`}
            />
            <StatCard
              title="Failed Requests"
              value={metrics.failedRequests}
              description="Requests recorded as failures"
            />
            <StatCard
              title="Average Duration"
              value={`${averageResponseTime.toFixed(1)} ms`}
              description="Average recorded request duration"
            />
          </div>
        </section>

        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold">Backend Metrics</h2>

          {Object.keys(metrics.backends).length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
              No backend requests recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full min-w-[500px] text-left text-sm">
                <thead className="bg-zinc-900 text-zinc-400">
                  <tr>
                    <th className="px-5 py-4 font-medium">Backend</th>
                    <th className="px-5 py-4 font-medium">Requests</th>
                    <th className="px-5 py-4 font-medium">Failures</th>
                    <th className="px-5 py-4 font-medium">Failure Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {Object.entries(metrics.backends).map(([name, backend]) => {
                    const failureRate =
                      backend.requests > 0
                        ? (backend.failures / backend.requests) * 100
                        : 0;

                    return (
                      <tr key={name} className="bg-zinc-950">
                        <td className="px-5 py-4 font-medium">{name}</td>
                        <td className="px-5 py-4">{backend.requests}</td>
                        <td className="px-5 py-4 text-red-400">
                          {backend.failures}
                        </td>
                        <td className="px-5 py-4">{failureRate.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold">Circuit Breakers</h2>

          {Object.keys(metrics.circuits).length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
              Circuit breaker states will appear when recorded by the proxy.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Object.entries(metrics.circuits).map(([name, circuit]) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-5"
                >
                  <div>
                    <p className="font-medium">{name}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Circuit breaker state
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColor(
                      circuit.state,
                    )}`}
                  >
                    {circuit.state}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="mt-12 border-t border-zinc-800 pt-5 text-xs text-zinc-500">
          net-flow · Custom TCP/HTTP Proxy · Live in-memory metrics
        </footer>
      </div>
    </main>
  );
}
