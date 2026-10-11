import { LiveError } from "../core";
import { readError } from "./errors";
import type {
  ArtifactHostBridgeApi,
  ArtifactMemberDto,
  ArtifactQuerySourceInputs,
  ArtifactQuerySourceResults,
  DataQueryResult,
  EmbedDataQuery,
  EmbedSearchRequest,
  KitQuerySource,
  SearchUpdate,
  UserActionOutcome,
} from "./wire";

/** The calls the kit makes to its host; every rejection is a `LiveError`. */
export interface LiveBridge {
  query<S extends KitQuerySource>(
    source: S,
    input: ArtifactQuerySourceInputs[S],
  ): Promise<ArtifactQuerySourceResults[S]>;
  queryData(query: EmbedDataQuery): Promise<DataQueryResult>;
  requestUserAction(
    actionType: string,
    params: Record<string, string>,
  ): Promise<UserActionOutcome>;
  subscribeSearch(
    search: EmbedSearchRequest,
    onUpdate: (update: SearchUpdate) => void,
  ): () => void;
  /** The current viewer, known to the host without a grant; throws `forbidden` on a host that predates it. */
  viewer(): ArtifactMemberDto;
}

type BridgeWindow = Window & { clickup?: ArtifactHostBridgeApi };

const rethrowAsLiveError = (reason: unknown): never => {
  throw readError(reason);
};

/** The bridge the ClickUp embed shell installs on `window.clickup`. */
export function windowBridge(): LiveBridge {
  const member = <K extends keyof ArtifactHostBridgeApi>(
    name: K,
  ): NonNullable<ArtifactHostBridgeApi[K]> => {
    const clickup = (window as BridgeWindow).clickup;
    if (!clickup) {
      throw new LiveError(
        "forbidden",
        "This artifact is not running inside a ClickUp host.",
      );
    }
    const value = clickup[name];
    if (!value) {
      throw new LiveError(
        "forbidden",
        `The host does not support ${name}; update the ClickUp app.`,
      );
    }
    return value;
  };

  return {
    async query(source, input) {
      const result = await member("query")(source, input).catch(
        rethrowAsLiveError,
      );
      return result as ArtifactQuerySourceResults[typeof source];
    },
    async queryData(query) {
      return member("queryData")(query).catch(rethrowAsLiveError);
    },
    async requestUserAction(actionType, params) {
      return member("requestUserAction")(actionType, params).catch(
        rethrowAsLiveError,
      );
    },
    subscribeSearch(search, onUpdate) {
      try {
        return member("subscribeSearch")(search, onUpdate);
      } catch (reason) {
        return rethrowAsLiveError(reason);
      }
    },
    viewer() {
      return member("getViewer")();
    },
  };
}
