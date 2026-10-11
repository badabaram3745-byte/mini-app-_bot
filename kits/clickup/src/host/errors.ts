import { LiveError } from "../core";
import type { UserActionOutcome } from "./wire";
import {
  ARTIFACT_ACTION_FAILURE_REASONS as FAILURE,
  ARTIFACT_READ_ERROR_CODES as READ,
  ARTIFACT_USER_ACTION_DENY_REASONS as DENY,
  NOT_DECLARED,
  NOT_ENABLED,
} from "./wire";

const FORBIDDEN_READS: ReadonlySet<string> = new Set([
  READ.capabilityRevoked,
  READ.dataSourceRevoked,
  READ.documentReplaced,
  READ.missingOrigin,
  READ.notGranted,
  READ.sourceUnavailable,
  NOT_DECLARED,
  NOT_ENABLED,
]);

const INVALID_READS: ReadonlySet<string> = new Set([
  READ.invalidLocation,
  READ.invalidQuery,
  READ.invalidSearch,
]);

const RETRYABLE_READS: ReadonlySet<string> = new Set([
  READ.queryFailed,
  READ.rateLimited,
  READ.searchFailed,
  READ.timeout,
  READ.tooManySubscriptions,
]);

/** Maps a raw bridge rejection to a `LiveError`. */
export function readError(reason: unknown): LiveError {
  if (reason instanceof LiveError) {
    return reason;
  }
  const raw =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string" && reason
        ? reason
        : "failed";
  if (FORBIDDEN_READS.has(raw) || raw.includes("is not granted")) {
    return new LiveError(
      "forbidden",
      `The host does not allow this read (${raw}).`,
      { reason: raw },
    );
  }
  if (raw.includes("is unavailable") || raw.includes("not connected")) {
    return new LiveError(
      "forbidden",
      "This artifact is not connected to a ClickUp host.",
      { reason: raw },
    );
  }
  if (INVALID_READS.has(raw)) {
    return new LiveError("invalid", `The host rejected the query (${raw}).`, {
      reason: raw,
    });
  }
  return new LiveError("failed", `The read failed (${raw}).`, {
    reason: raw,
    retryable: RETRYABLE_READS.has(raw),
  });
}

const FORBIDDEN_DENIALS: ReadonlySet<string> = new Set([
  DENY.grantRevoked,
  DENY.notGranted,
  DENY.unknownAction,
  NOT_DECLARED,
  NOT_ENABLED,
]);

const RETRYABLE_FAILURES: ReadonlySet<string> = new Set([
  FAILURE.stateChanged,
  FAILURE.executionFailed,
]);

/** Maps a non-executed action outcome to a `LiveError`. */
export function actionError(
  actionType: string,
  outcome: UserActionOutcome,
): LiveError {
  const reason = outcome.reason;
  const detail = reason ? ` (${reason})` : "";
  if (outcome.status === "denied") {
    if (reason === DENY.userDenied) {
      return new LiveError(
        "denied",
        `The user did not approve ${actionType}.`,
        { reason },
      );
    }
    if (reason && FORBIDDEN_DENIALS.has(reason)) {
      return new LiveError(
        "forbidden",
        `The host does not allow ${actionType}${detail}.`,
        { reason },
      );
    }
    if (reason === DENY.invalidParams) {
      return new LiveError(
        "invalid",
        `The host rejected the parameters of ${actionType}.`,
        { reason },
      );
    }
    return new LiveError("failed", `${actionType} was not accepted${detail}.`, {
      reason,
      retryable: true,
    });
  }
  return new LiveError("failed", `${actionType} failed${detail}.`, {
    reason,
    retryable: reason !== undefined && RETRYABLE_FAILURES.has(reason),
  });
}
