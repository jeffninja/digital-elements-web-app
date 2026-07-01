// Turns a raw fetch result into an HTTPS status verdict.

export function checkHttps(fetchResult) {
  if (!fetchResult.ok) {
    return {
      status: "fail",
      label: "Unreachable",
      detail: fetchResult.error || "No response",
    };
  }

  const { status, isHttps, responseTimeMs } = fetchResult;

  if (status >= 500) {
    return { status: "fail", label: `HTTP ${status}`, detail: "Server error", responseTimeMs };
  }
  if (status >= 400) {
    return { status: "fail", label: `HTTP ${status}`, detail: "Client error", responseTimeMs };
  }
  if (!isHttps) {
    return {
      status: "fail",
      label: "Not secure",
      detail: "Final URL is not served over HTTPS",
      responseTimeMs,
    };
  }
  if (status >= 300) {
    return { status: "warn", label: `HTTP ${status}`, detail: "Unexpected redirect status", responseTimeMs };
  }

  return {
    status: "ok",
    label: `${status} · ${responseTimeMs}ms`,
    detail: "Reachable over HTTPS",
    responseTimeMs,
  };
}
