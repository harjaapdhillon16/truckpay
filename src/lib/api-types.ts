import type { connectionStatus } from "./wallet";
import type { driverView, loadDetail, loadView } from "./views";

/** Response shapes of our own API, derived from the server code that builds them. */
type Jsonify<T> = T extends Date
  ? string
  : T extends bigint
    ? string
    : T extends (infer U)[]
      ? Jsonify<U>[]
      : T extends object
        ? { [K in keyof T]: Jsonify<T[K]> }
        : T;

export type LoadViewT = Jsonify<ReturnType<typeof loadView>>;
export type LoadDetailT = Jsonify<ReturnType<typeof loadDetail>>;
export type DriverViewT = Jsonify<ReturnType<typeof driverView>>;
export type StatusT = Jsonify<Awaited<ReturnType<typeof connectionStatus>>>;
export type LoadsListT = { loads: LoadViewT[]; stats: { toCarriers: number; committed: number; blocked: number; mode: string } };
