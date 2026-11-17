import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowDown,
  faArrowUp,
  faCheck,
  faChevronDown,
  faCircleInfo,
  faGlobe,
  faServer,
  faShareNodes,
  faRotateRight,
  faStopwatch,
  faWaveSquare,
} from "@fortawesome/free-solid-svg-icons";
import "./SpeedTestGauge.css";

const MAX_SPEED = 100;
const PHASE_LABELS = {
  idle: "Ready to test",
  checking: "Measuring latency",
  connecting: "Connecting to the test server",
  download: "Measuring download speed",
  upload: "Measuring upload speed",
  complete: "Speed test complete",
  error: "Unable to complete the test",
};

function scaleSpeed(value, maxSpeed) {
  const clamped = Math.max(0, Math.min(maxSpeed, Number(value) || 0));
  return clamped / maxSpeed;
}

function pointAt(cx, cy, radius, angleDegrees) {
  const radians = (angleDegrees * Math.PI) / 180;
  return {
    x: cx + Math.cos(radians) * radius,
    y: cy + Math.sin(radians) * radius,
  };
}

function convertSpeed(mbps, unit) {
  switch (unit) {
    case "MB/s":
      return mbps / 8;
    case "Kbps":
      return mbps * 1000;
    case "Gbps":
      return mbps / 1000;
    default:
      return mbps;
  }
}

function formatSpeed(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "--";
  }
  const numeric = Number(value);
  const fractionDigits = numeric >= 100 ? 1 : 2;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(numeric);
}

function Sparkline({ values, tone = "blue" }) {
  const samples = Array.isArray(values)
    ? values.filter((value) => Number.isFinite(Number(value)))
    : [];
  const chartValues = samples.length > 1 ? samples : [0, 0, 0, 0, 0, 0];
  const max = Math.max(...chartValues, 1);
  const points = chartValues.map((value, index) => {
    const x = (index / (chartValues.length - 1)) * 150;
    const y = 39 - (Math.max(0, value) / max) * 30;
    return [x, y];
  });
  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");
  const area = `${line} L 150 44 L 0 44 Z`;

  return (
    <svg
      className={`mst-sparkline mst-sparkline--${tone}`}
      viewBox="0 0 150 48"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className="mst-sparkline__area" d={area} />
      <path className="mst-sparkline__line" d={line} />
    </svg>
  );
}

function SpeedMetric({ label, value, unit, values, tone }) {
  return (
    <article className={`mst-speed-metric mst-speed-metric--${tone}`}>
      <div className="mst-speed-metric__icon" aria-hidden="true">
        <FontAwesomeIcon icon={tone === "blue" ? faArrowDown : faArrowUp} />
      </div>
      <div className="mst-speed-metric__copy">
        <span>{label}</span>
        <strong>
          <span className="mst-speed-metric__value">
            {value == null ? "--" : formatSpeed(convertSpeed(value, unit))}
          </span>
          <small>{unit}</small>
        </strong>
      </div>
      <Sparkline values={values} tone={tone} />
    </article>
  );
}

function SignalMetric({ label, value, unit, tone = "blue", icon }) {
  return (
    <article className={`mst-signal-metric mst-signal-metric--${tone}`}>
      <span className="mst-signal-metric__icon" aria-hidden="true">
        <FontAwesomeIcon icon={icon} />
      </span>
      <span className="mst-signal-metric__copy">
        <span>{label}</span>
        <strong>
          <span className="mst-signal-metric__value">
            {value == null
              ? "--"
              : unit === "s"
                ? Number(value).toFixed(3)
                : Number(value).toFixed(label === "Jitter" ? 1 : 0)}
          </span>
          <small>{unit}</small>
        </strong>
      </span>
    </article>
  );
}

function Gauge({ speedMbps, maxSpeed, speedUnit, phase }) {
  const normalizedSpeed = Math.max(0, Math.min(maxSpeed, Number(speedMbps) || 0));
  const ratio = scaleSpeed(normalizedSpeed, maxSpeed);
  const dot = pointAt(150, 150, 119, -90 + ratio * 360);
  const isSpeedPhase =
    ["download", "upload", "complete", "error"].includes(phase) &&
    speedMbps != null;
  const displaySpeed = isSpeedPhase
    ? formatSpeed(convertSpeed(normalizedSpeed, speedUnit))
    : "--";

  return (
    <svg className="mst-gauge" viewBox="0 0 300 300" role="img" aria-label={`Speed: ${displaySpeed} ${speedUnit}`}>
      <circle className="mst-gauge__track" cx="150" cy="150" r="119" />
      <circle
        className={`mst-gauge__progress${phase === "complete" ? " mst-gauge__progress--frozen" : ""}`}
        stroke={phase === "upload" ? "#111827" : "#1769ff"}
        cx="150"
        cy="150"
        r="119"
        pathLength="100"
        strokeDasharray="100"
        strokeDashoffset={100 - (isSpeedPhase ? ratio * 100 : 0)}
        strokeWidth={5 + (isSpeedPhase ? ratio : 0) * 7}
        transform="rotate(-90 150 150)"
      />
      {isSpeedPhase && ratio > 0 && (
        <circle
          className="mst-gauge__dot"
          cx={dot.x}
          cy={dot.y}
          r={4 + ratio * 3}
        />
      )}
      <text className="mst-gauge__value" x="150" y="151">
        {displaySpeed}
      </text>
      <text className="mst-gauge__unit" x="150" y="180">
        {speedUnit}
      </text>
    </svg>
  );
}

function getNetworkDetails(client) {
  const isAvailable = (value) =>
    typeof value === "string" &&
    value.trim() !== "" &&
    !/^(unknown|n\/a|unavailable)(?:\b|$)/i.test(value.trim());
  const networkName = [
    client?.asnOrganization,
    client?.asnName,
    client?.networkName,
    client?.network,
    client?.organization,
    client?.org,
    client?.connection?.asnOrganization,
    client?.connection?.asnName,
    client?.connection?.asn_name,
    client?.connection?.organization,
    client?.connection?.org,
    client?.isp,
    client?.connection?.isp,
  ]
    .find(isAvailable)
    ?.trim();
  const ipAddress = [
    client?.ip,
    client?.ipAddress,
    client?.ip_address,
    client?.publicIp,
  ]
    .find(isAvailable)
    ?.trim();
  const asnValue =
    client?.asn?.asn ??
    client?.asn?.number ??
    client?.asn?.value ??
    client?.asn ??
    client?.connection?.asn;
  const asnText =
    typeof asnValue === "number" && Number.isFinite(asnValue)
      ? String(asnValue)
      : isAvailable(asnValue)
        ? asnValue.trim()
        : "";
  const asnDigits = asnText.replace(/^(?:AS)+/i, "");
  const asn = asnText
    ? /^\d+$/.test(asnDigits)
      ? `AS${asnDigits}`
      : asnText
    : "";
  const asnIsIncluded = asn && networkName.toUpperCase().includes(asn.toUpperCase());
  const networkLabel = networkName
    ? asn && !asnIsIncluded
      ? `${networkName} (${asn})`
      : networkName
    : "";

  return networkLabel && ipAddress
    ? {
        networkLabel,
        networkName,
        asn: asnIsIncluded ? "" : asn,
        ipAddress,
      }
    : null;
}

function NetworkSummary({ details }) {
  if (!details) return null;

  return (
    <section className="mst-network-summary" aria-label="Network details">
      <div className="mst-network-summary__items">
        <div className="mst-network-summary__item">
          <FontAwesomeIcon icon={faServer} aria-hidden="true" />
          <span>
            <small>Connection details</small>
            <strong title={details.networkLabel}>
              {details.networkName}
              {details.asn && (
                <span className="mst-network-summary__number">
                  {" "}
                  ({details.asn})
                </span>
              )}
            </strong>
          </span>
        </div>
        <div className="mst-network-summary__item mst-network-summary__item--ip">
          <FontAwesomeIcon icon={faGlobe} aria-hidden="true" />
          <span>
            <small>IP address</small>
            <strong>{details.ipAddress}</strong>
          </span>
        </div>
      </div>
    </section>
  );
}

export default function SpeedTestGauge({
  phase = "idle",
  speedMbps = null,
  latencyMs = null,
  jitterMs = null,
  downloadMbps = null,
  uploadMbps = null,
  downloadSamples = [],
  uploadSamples = [],
  serverStatus = "not-checked",
  errorMessage = "Check your connection and try again.",
  maxSpeed = MAX_SPEED,
  speedUnit = "Mbps",
  latencyUnit = "ms",
  networkInfo = null,
  networkInfoLoading = false,
  onLoadNetworkInfo,
  onStart,
}) {
  const [shareFeedback, setShareFeedback] = useState("");
  const [meterVisible, setMeterVisible] = useState(true);
  const isRunning = ["checking", "connecting", "download", "upload"].includes(phase);
  const isCompleted = phase === "complete";
  const shouldShowMeter = !isCompleted || meterVisible;
  const isConnected = serverStatus === "connected" || phase === "complete";
  const phaseLabel = PHASE_LABELS[phase] || PHASE_LABELS.idle;
  const maxValue = Math.max(1, Number(maxSpeed) || MAX_SPEED);
  const latencyValue = latencyMs == null
    ? null
    : latencyUnit === "s"
      ? latencyMs / 1000
      : latencyMs;
  const jitterValue = jitterMs == null
    ? null
    : latencyUnit === "s"
      ? jitterMs / 1000
      : jitterMs;
  const displayedSpeed = speedMbps == null ? null : speedMbps;
  const networkDetails = getNetworkDetails(networkInfo?.client);
  useEffect(() => {
    if (isCompleted) {
      const exitDelay = window.matchMedia?.("(prefers-reduced-motion: reduce)")
        .matches
        ? 0
        : 380;
      const timeoutId = window.setTimeout(() => setMeterVisible(false), exitDelay);
      return () => window.clearTimeout(timeoutId);
    }
    setMeterVisible(true);
  }, [isCompleted]);
  const caption = {
    idle: "Check the speed of your internet connection.",
    download: "Download speed",
    upload: "Upload speed",
    error: "The test could not connect. Try again in a moment.",
  }[phase] || "Connecting to a nearby measurement server";

  const handleShare = async () => {
    const formattedSpeed = (value) =>
      value == null
        ? "Not measured"
        : `${formatSpeed(convertSpeed(value, speedUnit))} ${speedUnit}`;
    const report = [
      "SpeedX internet speed test",
      `Download: ${formattedSpeed(downloadMbps)}`,
      `Upload: ${formattedSpeed(uploadMbps)}`,
      `Idle latency: ${latencyMs == null ? "Not measured" : `${Math.round(latencyMs)} ms`}`,
      `Jitter: ${jitterMs == null ? "Not measured" : `${Math.round(jitterMs)} ms`}`,
      window.location.href,
    ]
      .filter(Boolean)
      .join("\n");

    setShareFeedback("");
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "SpeedX speed test result",
          text: report,
        });
        setShareFeedback("Result shared.");
        return;
      } catch (shareError) {
        if (shareError?.name === "AbortError") return;
      }
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(report);
      } else {
        const field = document.createElement("textarea");
        field.value = report;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        if (!copied) throw new Error("Clipboard access is unavailable.");
      }
      setShareFeedback("Result copied to clipboard.");
    } catch {
      setShareFeedback("Sharing is unavailable in this browser.");
    }
  };

  return (
    <section className="mst-shell" id="speed-test">
      <section
        className={`mst-test${isCompleted ? " is-completed" : ""}`}
        aria-label="Internet speed test"
      >
        <div className="mst-test__eyebrow">
          <span
            className={`mst-status-dot${
              isConnected ? " is-connected" : isRunning ? " is-running" : ""
            }${isCompleted ? " is-completed" : ""}`}
          >
            {isCompleted && (
              <FontAwesomeIcon icon={faCheck} aria-hidden="true" />
            )}
          </span>
          {phaseLabel}
        </div>

        {shouldShowMeter && (
          <div
            className={`mst-meter${isCompleted ? " is-exiting" : ""}`}
            aria-live="polite"
            aria-hidden={isCompleted}
          >
            <Gauge
              speedMbps={displayedSpeed}
              maxSpeed={maxValue}
              speedUnit={speedUnit}
              phase={phase}
            />
          </div>
        )}

        {!isCompleted && <p className="mst-test__caption">{caption}</p>}

        {!isRunning && !isCompleted && (
          <button className="mst-start-button" type="button" onClick={onStart}>
            {phase === "idle"
              ? "START"
              : "TRY AGAIN"}
          </button>
        )}
        {isRunning && (
          <div className="mst-progress-note" role="status">
            <span className="mst-spinner" />
            <span>{phaseLabel}</span>
          </div>
        )}

        {phase === "error" && (
          <p className="mst-error-copy" role="alert">
            {errorMessage}
          </p>
        )}

        {phase !== "idle" && (
          <section className="mst-results" aria-label="Test results">
            <div className="mst-results__grid">
              <SpeedMetric
                label="Download"
                value={downloadMbps}
                unit={speedUnit}
                values={downloadSamples}
                tone="blue"
              />
              <SpeedMetric
                label="Upload"
                value={uploadMbps}
                unit={speedUnit}
                values={uploadSamples}
                tone="black"
              />
              <SignalMetric
                label="Latency"
                value={latencyValue}
                unit={latencyUnit}
                tone="blue"
                icon={faStopwatch}
              />
              <SignalMetric
                label="Jitter"
                value={jitterValue}
                unit={latencyUnit}
                tone="violet"
                icon={faWaveSquare}
              />
            </div>

            {isCompleted && (
              <details
                className="mst-details"
                onToggle={(event) => {
                  if (
                    event.currentTarget.open &&
                    !networkDetails &&
                    !networkInfoLoading
                  ) {
                    onLoadNetworkInfo?.();
                  }
                }}
              >
                <summary>
                  <FontAwesomeIcon
                    className="mst-details__info-icon"
                    icon={faCircleInfo}
                    aria-hidden="true"
                  />
                  <span className="mst-details__label mst-details__label--more">
                    Show more
                  </span>
                  <span className="mst-details__label mst-details__label--less">
                    Show less
                  </span>
                  <FontAwesomeIcon
                    className="mst-details__chevron"
                    icon={faChevronDown}
                    aria-hidden="true"
                  />
                </summary>
                <div className="mst-details__content">
                  {networkInfoLoading && !networkDetails && (
                    <p className="mst-network-loading" role="status">
                      Looking up your connection details…
                    </p>
                  )}
                  {networkDetails && <NetworkSummary details={networkDetails} />}
                </div>
              </details>
            )}
            {isCompleted && (
              <section className="mst-result-actions" aria-label="Result actions">
                <div className="mst-result-actions__buttons">
                  <button
                    className="mst-action-button mst-action-button--primary"
                    type="button"
                    onClick={() => {
                      setShareFeedback("");
                      onStart?.();
                    }}
                  >
                    <FontAwesomeIcon icon={faRotateRight} aria-hidden="true" />
                    Test again
                  </button>
                  <button
                    className="mst-action-button"
                    type="button"
                    onClick={handleShare}
                  >
                    <FontAwesomeIcon icon={faShareNodes} aria-hidden="true" />
                    Share result
                  </button>
                </div>
                {shareFeedback && (
                  <p className="mst-share-feedback" role="status">
                    {shareFeedback}
                  </p>
                )}
              </section>
            )}
          </section>
        )}
      </section>
    </section>
  );
}
