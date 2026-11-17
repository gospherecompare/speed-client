import { useCallback, useEffect, useRef, useState } from "react";
import { Settings2, X } from "lucide-react";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import SpeedTestGauge from "./SpeedTestGauge.jsx";
import "./styles.css";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/+$/,
  "",
);
const PING_SAMPLES = 5;
const TEST_DURATION_MS = 6000;
const DOWNLOAD_WORKERS = 3;
const UPLOAD_WORKERS = 3;
const UPLOAD_PAYLOAD_BYTES = 4 * 1024 * 1024;
const SPEED_UNITS = ["Mbps", "MB/s", "Kbps", "Gbps"];
const GAUGE_SCALES = ["auto", "100", "500", "1000", "2500", "5000"];

function apiUrl(path) {
  return API_BASE_URL + path;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

// This app reports jitter as the mean absolute difference between
// consecutive HTTP round-trip-time samples. It is not an ICMP measurement.
function calculateJitter(samples) {
  if (samples.length < 2) return 0;
  const totalVariation = samples
    .slice(1)
    .reduce(
      (total, sample, index) => total + Math.abs(sample - samples[index]),
      0,
    );
  return totalVariation / (samples.length - 1);
}

function toMbps(bytes, seconds) {
  return seconds > 0 ? (bytes * 8) / seconds / 1_000_000 : 0;
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function getGaugeScale(speed, selection) {
  if (selection !== "auto") return Number(selection);
  const target = Math.max(100, speed * 1.25);
  return Math.ceil(target / 25) * 25;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  const [phase, setPhase] = useState("idle");
  const [serverConnected, setServerConnected] = useState(false);
  const [liveSpeed, setLiveSpeed] = useState(0);
  const [ping, setPing] = useState(null);
  const [jitter, setJitter] = useState(null);
  const [download, setDownload] = useState(null);
  const [upload, setUpload] = useState(null);
  const [downloadSamples, setDownloadSamples] = useState([]);
  const [uploadSamples, setUploadSamples] = useState([]);
  const [error, setError] = useState("");
  const [networkInfo, setNetworkInfo] = useState(null);
  const [networkInfoLoading, setNetworkInfoLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [speedUnit, setSpeedUnit] = useState(
    () => localStorage.getItem("mobilesx.speedUnit") || "Mbps",
  );
  const [scaleMode, setScaleMode] = useState(
    () => localStorage.getItem("mobilesx.gaugeScale") || "auto",
  );
  const [autoGaugeScale, setAutoGaugeScale] = useState(100);
  const runId = useRef(0);
  const networkInfoRequest = useRef(0);

  useEffect(
    () => localStorage.setItem("mobilesx.speedUnit", speedUnit),
    [speedUnit],
  );
  useEffect(
    () => localStorage.setItem("mobilesx.gaugeScale", scaleMode),
    [scaleMode],
  );
  const loadNetworkInfo = useCallback(async () => {
    const requestId = networkInfoRequest.current + 1;
    networkInfoRequest.current = requestId;
    setNetworkInfoLoading(true);
    try {
      const response = await fetch(apiUrl("/api/network-info"), {
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.client || typeof data.client !== "object") {
        throw new Error("Network details are unavailable.");
      }
      if (networkInfoRequest.current === requestId) setNetworkInfo(data);
    } catch {
      if (networkInfoRequest.current === requestId) setNetworkInfo(null);
    } finally {
      if (networkInfoRequest.current === requestId) {
        setNetworkInfoLoading(false);
      }
    }
  }, []);
  const running = ["ping", "download", "upload"].includes(phase);
  const displayedDownload = phase === "download" ? liveSpeed : download;
  const displayedUpload = phase === "upload" ? liveSpeed : upload;
  const activeSpeed =
    phase === "upload"
      ? liveSpeed
      : phase === "download"
        ? liveSpeed
        : (download ?? 0);
  useEffect(() => {
    if (
      scaleMode === "auto" &&
      ["download", "upload", "complete"].includes(phase)
    ) {
      const nextScale = getGaugeScale(activeSpeed, "auto");
      setAutoGaugeScale((currentScale) => Math.max(currentScale, nextScale));
    }
  }, [activeSpeed, phase, scaleMode]);

  const measurePing = async () => {
    setPhase("ping");
    const samples = [];

    for (let index = 0; index < PING_SAMPLES; index += 1) {
      const startedAt = performance.now();
      const response = await fetch(
        apiUrl(`/api/ping?sample=${Date.now()}-${index}`),
        { cache: "no-store" },
      );
      if (!response.ok)
        throw new Error(`Latency request failed (${response.status}).`);
      await response.text();
      setServerConnected(true);
      samples.push(performance.now() - startedAt);
      setPing(round(median(samples)));
      if (samples.length > 1) setJitter(round(calculateJitter(samples)));
    }
    return {
      latency: round(median(samples)),
      jitter: round(calculateJitter(samples)),
    };
  };

  const measureDownload = async () => {
    setPhase("download");
    setLiveSpeed(0);
    const controller = new AbortController();
    const startedAt = performance.now();
    let bytesReceived = 0;
    let workerError = "";

    const workers = Array.from(
      { length: DOWNLOAD_WORKERS },
      async (_, index) => {
        try {
          const response = await fetch(
            apiUrl(`/api/download?stream=${index}&nonce=${Date.now()}`),
            {
              cache: "no-store",
              signal: controller.signal,
            },
          );
          if (!response.ok)
            throw new Error(`Download request failed (${response.status}).`);
          if (!response.body)
            throw new Error(
              "This browser does not support streaming downloads.",
            );
          const reader = response.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              bytesReceived += value.byteLength;
            }
          } finally {
            reader.releaseLock();
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            workerError = formatError(error);
            controller.abort();
          }
        }
      },
    );

    const interval = window.setInterval(() => {
      const elapsed = (performance.now() - startedAt) / 1000;
      const currentSpeed = toMbps(bytesReceived, elapsed);
      setLiveSpeed(currentSpeed);
      setDownloadSamples((samples) => [...samples.slice(-23), currentSpeed]);
    }, 180);

    const deadline = startedAt + TEST_DURATION_MS;
    while (performance.now() < deadline && !workerError) {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }

    const endedAt = performance.now();
    controller.abort();
    window.clearInterval(interval);
    await Promise.all(workers);
    if (workerError) throw new Error(workerError);

    const result = round(toMbps(bytesReceived, (endedAt - startedAt) / 1000));
    setLiveSpeed(result);
    setDownloadSamples((samples) => [...samples.slice(-23), result]);
    return result;
  };

  const measureUpload = async () => {
    setPhase("upload");
    setLiveSpeed(0);

    const payload = new Blob([new Uint8Array(UPLOAD_PAYLOAD_BYTES)], {
      type: "application/octet-stream",
    });
    const tracker = {
      confirmedBytes: 0,
      activeBytes: new Map(),
      requests: new Set(),
      stopping: false,
      error: "",
    };
    const currentBytes = () =>
      tracker.confirmedBytes +
      [...tracker.activeBytes.values()].reduce(
        (total, bytes) => total + bytes,
        0,
      );

    const stopWorkers = () => {
      tracker.stopping = true;
      for (const request of tracker.requests) request.abort();
    };

    const workers = Array.from(
      { length: UPLOAD_WORKERS },
      () =>
        new Promise((resolve) => {
          const sendNext = () => {
            if (tracker.stopping) return resolve();
            const request = new XMLHttpRequest();
            tracker.requests.add(request);
            tracker.activeBytes.set(request, 0);
            request.open("POST", apiUrl("/api/upload"));
            request.responseType = "json";
            request.setRequestHeader(
              "Content-Type",
              "application/octet-stream",
            );
            request.upload.onprogress = (event) =>
              tracker.activeBytes.set(request, event.loaded);
            request.onload = () => {
              const receivedBytes = request.response?.receivedBytes;
              if (
                request.status < 200 ||
                request.status >= 300 ||
                receivedBytes !== payload.size
              ) {
                tracker.error =
                  request.response?.error ??
                  `Upload request failed (${request.status}).`;
                stopWorkers();
                tracker.activeBytes.delete(request);
                tracker.requests.delete(request);
                resolve();
                return;
              }
              tracker.confirmedBytes += receivedBytes;
              tracker.activeBytes.delete(request);
              tracker.requests.delete(request);
              sendNext();
            };
            request.onerror = () => {
              tracker.error =
                "Upload request failed. Check the connection to the test server.";
              stopWorkers();
              tracker.activeBytes.delete(request);
              tracker.requests.delete(request);
              resolve();
            };
            request.onabort = () => {
              tracker.activeBytes.delete(request);
              tracker.requests.delete(request);
              resolve();
            };
            request.send(payload);
          };
          sendNext();
        }),
    );

    const startedAt = performance.now();
    const interval = window.setInterval(() => {
      const elapsed = (performance.now() - startedAt) / 1000;
      const currentSpeed = toMbps(currentBytes(), elapsed);
      setLiveSpeed(currentSpeed);
      setUploadSamples((samples) => [...samples.slice(-23), currentSpeed]);
    }, 180);

    const deadline = startedAt + TEST_DURATION_MS;
    while (performance.now() < deadline && !tracker.error) {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }

    const endedAt = performance.now();
    const bytesAtStop = currentBytes();
    window.clearInterval(interval);
    stopWorkers();
    await Promise.all(workers);
    if (tracker.error) throw new Error(tracker.error);

    const result = round(toMbps(bytesAtStop, (endedAt - startedAt) / 1000));
    setLiveSpeed(result);
    setUploadSamples((samples) => [...samples.slice(-23), result]);
    return result;
  };

  const startTest = async () => {
    if (running) return;
    const currentRun = runId.current + 1;
    runId.current = currentRun;
    setError("");
    setServerConnected(false);
    setPing(null);
    setJitter(null);
    setDownload(null);
    setUpload(null);
    setDownloadSamples([]);
    setUploadSamples([]);
    setLiveSpeed(0);
    setAutoGaugeScale(100);

    try {
      const pingResult = await measurePing();
      if (runId.current !== currentRun) return;
      setPing(pingResult.latency);
      setJitter(pingResult.jitter);

      const measuredDownload = await measureDownload();
      if (runId.current !== currentRun) return;
      setDownload(measuredDownload);

      const measuredUpload = await measureUpload();
      if (runId.current !== currentRun) return;
      setUpload(measuredUpload);
      setLiveSpeed(measuredDownload);
      setPhase("complete");
    } catch (testError) {
      setPhase("error");
      setError(formatError(testError));
    }
  };

  const dashboardPhase =
    phase === "ping" ? (serverConnected ? "checking" : "connecting") : phase;
  const dashboardServerStatus = serverConnected
    ? "connected"
    : phase === "error"
      ? "unavailable"
      : running
        ? "connecting"
        : "not-checked";
  const gaugeScale =
    scaleMode === "auto"
      ? autoGaugeScale
      : getGaugeScale(activeSpeed, scaleMode);
  const speedForGauge = ["download", "upload", "complete"].includes(phase)
    ? activeSpeed
    : phase === "error" && download != null
      ? download
      : null;

  return (
    <div className="app-shell mst-app">
      <header className="mst-controls">
        <a
          className="mst-brand"
          href="#top"
          aria-label="SpeedX internet speed test"
        >
          <img
            className="mst-brand__logo"
            src="/speedx-header-logo.png"
            alt="SpeedX"
          />
        </a>
        <button
          className={`settings-button${settingsOpen ? " is-open" : ""}`}
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          aria-expanded={settingsOpen}
          aria-label="Open test settings"
        >
          <Settings2 size={17} /> <span>Settings</span>
        </button>

        {settingsOpen && (
          <div
            className="settings-panel"
            role="dialog"
            aria-label="Speed test settings"
          >
            <div className="settings-panel__header">
              <div>
                <Settings2 size={17} />
                <strong>Test settings</strong>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
              >
                <X size={17} />
              </button>
            </div>
            <label className="setting-row">
              <span>
                <strong>Speed unit</strong>
                <small>Download and upload</small>
              </span>
              <select
                value={speedUnit}
                onChange={(event) => setSpeedUnit(event.target.value)}
              >
                {SPEED_UNITS.map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </select>
            </label>
            <label className="setting-row">
              <span>
                <strong>Gauge scale</strong>
                <small>Maximum dial value</small>
              </span>
              <select
                value={scaleMode}
                onChange={(event) => setScaleMode(event.target.value)}
              >
                {GAUGE_SCALES.map((scale) => (
                  <option key={scale} value={scale}>
                    {scale === "auto" ? "Automatic" : `${scale} Mbps`}
                  </option>
                ))}
              </select>
            </label>
            <p className="settings-panel__note">
              Speed units change how results are displayed. Latency is always
              shown in milliseconds. Gauge scale only affects the live dial.
            </p>
          </div>
        )}
      </header>

      <main id="top">
        <SpeedTestGauge
          phase={dashboardPhase}
          speedMbps={speedForGauge}
          latencyMs={ping}
          jitterMs={jitter}
          downloadMbps={displayedDownload}
          uploadMbps={displayedUpload}
          downloadSamples={downloadSamples}
          uploadSamples={uploadSamples}
          serverStatus={dashboardServerStatus}
          errorMessage={error}
          maxSpeed={gaugeScale}
          speedUnit={speedUnit}
          latencyUnit="ms"
          networkInfo={networkInfo}
          networkInfoLoading={networkInfoLoading}
          onLoadNetworkInfo={loadNetworkInfo}
          onStart={startTest}
        />
      </main>
      <footer className="mst-footer">
        <div className="mst-footer__inner">
          <div className="mst-footer__brandline">
            <span className="mst-footer__rule" aria-hidden="true" />
            <span className="mst-footer__eyebrow">Powered by</span>
            <strong className="mst-footer__brand">
              Mobiles<span>X</span>
            </strong>
            <span className="mst-footer__rule" aria-hidden="true" />
          </div>
          <p className="mst-footer__caption">SpeedX Internet Speed Test</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
