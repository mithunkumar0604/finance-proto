import { describe, expect, it } from "vitest";
import { permissions } from "./selectors";
import type { AppState } from "./store";
import type { Customer } from "./types";

const as = (viewAs: "owner" | "staff" | "collector") => permissions({ session: { loggedIn: true, locked: false, viewAs } } as unknown as AppState);
const flags = ({ role: _role, customerScope: _scope, ...rest }: ReturnType<typeof permissions>) => rest; // eslint-disable-line @typescript-eslint/no-unused-vars

describe("permissions", () => {
  it("staff can do what the owner does, except the Users page and changing a password", () => {
    expect(flags(as("staff"))).toEqual({ ...flags(as("owner")), seeUsers: false, changePassword: false });
    expect(as("owner")).toMatchObject({ seeTotals: true, seeReports: true, receive: true, waive: true, createLoan: true, addCustomer: true, seeUsers: true, changePassword: true });
    expect(as("staff").customerScope({ collectorId: "someone-else" } as Customer)).toBe(true);
  });

  it("a collector stays as before", () => {
    expect(as("collector")).toMatchObject({ seeTotals: false, seeReports: false, receive: true, waive: false, createLoan: false, addCustomer: false, seeUsers: false, changePassword: true });
  });
});
