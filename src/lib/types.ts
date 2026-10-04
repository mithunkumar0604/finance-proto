// Domain types. These mirror what a future API would return, so the UI can be
// wired to a real backend later without changing components.

export type ISODate = string; // "YYYY-MM-DD"

export type LoanType = "weekly" | "monthly" | "15day" | "30day" | "vehicle" | "jewel" | "custom";
export type Frequency = "weekly" | "15days" | "30days" | "monthly" | "custom";
export type InterestStyle = "percent" | "fixed" | "custom";
export type InterestMethod = "fixed" | "reducing" | "manual";
export type PaymentMethod = "cash" | "bank" | "upi" | "other";

export interface Customer {
  id: string;
  name: string;
  phone: string;
  altPhone?: string;
  area: string;
  address?: string;
  idRef?: string;
  notes?: string;
  createdAt: ISODate;
  collectorId?: string;
}

export interface JewelSecurity {
  kind: "jewel";
  description: string;
  weightGrams: number;
  purity: string;
  estimatedValue: number;
  packetNo: string;
  storage: string;
  notes?: string;
  status: SecurityStatus;
}

export interface VehicleSecurity {
  kind: "vehicle";
  registration: string;
  vehicleType: "car" | "bike" | "commercial" | "other";
  make: string;
  model: string;
  ownerName: string;
  rcRef: string;
  documentHeld: string;
  storage: string;
  status: SecurityStatus;
}

export interface DocumentSecurity {
  kind: "document";
  documentType: string;
  owner: string;
  referenceNo: string;
  original: boolean;
  description: string;
  storage: string;
  status: SecurityStatus;
}

export interface OtherSecurity {
  kind: "other";
  description: string;
  storage: string;
  status: SecurityStatus;
}

export type SecurityStatus = "held" | "released";
export type Security = JewelSecurity | VehicleSecurity | DocumentSecurity | OtherSecurity;

export interface InterestSetting {
  style: InterestStyle;
  /** Percent (e.g. 3 for 3%) when style = percent, rupees when style = fixed. */
  value: number;
  method: InterestMethod;
}

export interface Loan {
  id: string; // "LP-1024"
  customerId: string;
  type: LoanType;
  amount: number; // money given
  startDate: ISODate;
  reference?: string;
  interest: InterestSetting;
  frequency: Frequency;
  /** Fixed principal collected with every due (weekly / daily style loans). 0 = interest-only. */
  principalPerDue: number;
  principalLeft: number;
  status: "active" | "closed";
  closedDate?: ISODate;
  security: Security | null;
  /** Database row version, sent back with every change so two people cannot overwrite each other. */
  version?: number;
}

/** One expected collection for a loan. The collection register is built from these. */
export interface Due {
  id: string;
  loanId: string;
  dueDate: ISODate;
  interestAmount: number;
  principalAmount: number;
  paid: number;
  /** How much of `paid` was interest. Absent on older records: then interest is assumed paid first. */
  interestPaid?: number;
  /** Written off when the loan was settled without paying this in full. Never counted as received. */
  waived?: number;
  lastPaidDate?: ISODate;
  /** Set when the date was moved. originalDate keeps the day it was first expected. */
  rescheduled?: { originalDate: ISODate; reason: string };
  /** A due that was replaced (e.g. by a settlement) and no longer expected. */
  cancelled?: boolean;
}

export interface Payment {
  id: string;
  loanId: string;
  customerId: string;
  /** Payment date: when the customer actually paid. All reports filter on this. */
  date: ISODate;
  /** Recorded date: when it was entered in the app. Differs for backdated entries. */
  recordedOn: ISODate;
  /** Principal left on the loan just before this payment. */
  principalBefore: number;
  interest: number;
  principal: number;
  other: number;
  method: PaymentMethod;
  note?: string;
  dueId?: string;
}

export interface Activity {
  id: string;
  at: string; // ISO datetime
  by: string;
  text: string;
  kind: "payment" | "loan" | "customer" | "reschedule" | "security" | "system";
}

export type DueStatus = "paid" | "partial" | "pending" | "overdue" | "rescheduled";

export interface Role {
  id: "owner" | "collector" | "staff";
  name: string;
}

export interface AppUser {
  id: string;
  name: string;
  phone: string;
  role: Role["id"];
  area?: string;
  active: boolean;
}
