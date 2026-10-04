// Fictional demo dataset. All names, numbers, vehicles and addresses are invented.
// Data is generated relative to "today" so the prototype always looks live,
// and history is produced by running the same payment logic the UI uses.
// Amounts in the specs below are written in rupees and converted to paise when built.

import { accrueDues, applyPayment, buildDue, openDue, previousDueDate } from "./finance/engine";
import { rupees } from "./finance/money";
import { shiftISO } from "./format";
import type {
  Activity,
  AppUser,
  Customer,
  Due,
  Frequency,
  InterestSetting,
  ISODate,
  Loan,
  LoanType,
  Payment,
  PaymentMethod,
  Security,
} from "./types";

export interface DemoDB {
  customers: Customer[];
  loans: Loan[];
  dues: Due[];
  payments: Payment[];
  activity: Activity[];
  users: AppUser[];
}

export const DEMO_USERS: AppUser[] = [
  { id: "U1", name: "Rajendran", phone: "9800012345", role: "owner", active: true },
  { id: "U2", name: "Mani", phone: "9800023456", role: "collector", area: "Perundurai & Chennimalai", active: true },
  { id: "U3", name: "Kavin", phone: "9800034567", role: "collector", area: "Erode & Bhavani", active: true },
  { id: "U4", name: "Deepa", phone: "9800045678", role: "staff", active: true },
];

// Small deterministic PRNG so the generated part of the dataset is stable.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

interface LoanSpec {
  id: string;
  customerId: string;
  type: LoanType;
  amount: number;
  frequency: Frequency;
  interest: InterestSetting;
  principalPerDue?: number;
  /** Completed on-time collections before the current due. */
  cycles: number;
  /** Current open due, days from today (negative = overdue). */
  dueOffset: number;
  /** Extra principal paid on a given cycle (1-based). */
  extraPrincipal?: Record<number, number>;
  /** Part payment already made on the current due. */
  partial?: { amount: number; offset: number };
  /** Current due already collected in full today. */
  paidToday?: boolean;
  reschedule?: { toOffset: number; reason: string };
  /** Loan fully settled; closed this many days ago. */
  closedDaysAgo?: number;
  /** For a closed loan: security already handed back to the customer. */
  released?: boolean;
  /** One past collection that was entered in the app late (backdated). */
  backdated?: { cycle: number; recordedDaysAgo: number };
  security?: Security | null;
  reference?: string;
}

const pct = (value: number, method: InterestSetting["method"] = "reducing"): InterestSetting => ({
  style: "percent",
  value,
  method,
});
const fixed = (value: number): InterestSetting => ({ style: "fixed", value, method: "fixed" });

// ---------------------------------------------------------------------------
// Hand-written customers (the demo story)
// ---------------------------------------------------------------------------

const C = (
  id: string,
  name: string,
  phone: string,
  area: string,
  address: string,
  createdDaysAgo: number,
  collectorId: string,
  extra: Partial<Customer> = {},
) => ({ id, name, phone, area, address, createdDaysAgo, collectorId, ...extra });

const STORY_CUSTOMERS = [
  C("C001", "Ravi Kumar", "9876543210", "Perundurai", "14, Gandhi Nagar, Perundurai", 300, "U2", { idRef: "Aadhaar ••••  4821", altPhone: "9443211098", notes: "Reliable. Runs a textile shop near the bus stand." }),
  C("C002", "Murugan S", "9443127781", "Chennimalai", "7/2, Market Road, Chennimalai", 220, "U2", { idRef: "Aadhaar •••• 7710", notes: "Transport business. Sometimes late, always pays." }),
  C("C003", "Suresh Kumar", "9003045127", "Erode", "22, Brough Road, Erode", 80, "U3", { idRef: "Voter ID •••• 118" }),
  C("C004", "Arun Prakash", "9789011245", "Bhavani", "3, Kaveri Street, Bhavani", 150, "U3"),
  C("C005", "Selvam", "9942067310", "Gobichettipalayam", "11, Periyar Nagar, Gobi", 140, "U3", { idRef: "Aadhaar •••• 3390" }),
  C("C006", "Karthik R", "9629854130", "Perundurai", "5, SIPCOT Colony, Perundurai", 40, "U2"),
  C("C007", "Prabhu M", "9843190876", "Kanjikoil", "18, Main Road, Kanjikoil", 190, "U2"),
  C("C008", "Vignesh K", "9047023984", "Erode", "9, Surampatti, Erode", 35, "U3"),
  C("C009", "Saravanan P", "9488012093", "Tiruppur", "41, Avinashi Road, Tiruppur", 420, "U1", { notes: "Large customer. Handles directly (owner)." }),
  C("C010", "Rajesh N", "9965038127", "Modakurichi", "2, Temple Street, Modakurichi", 330, "U3"),
  C("C011", "Manikandan", "9750866241", "Vijayamangalam", "6, School Road, Vijayamangalam", 60, "U2"),
  C("C012", "Gopal R", "9442355190", "Sivagiri", "15, North Street, Sivagiri", 400, "U3"),
  C("C013", "Sathish Kumar", "9894077102", "Ingur", "27, Ingur Main Road", 170, "U2"),
  C("C014", "Senthil V", "9003688215", "Kodumudi", "8, River View, Kodumudi", 260, "U3"),
  C("C015", "Naveen Raj", "9655730418", "Perundurai", "31, Kongu Nagar, Perundurai", 20, "U2"),
  C("C016", "Balamurugan T", "9486621307", "Bhavani", "12, Lakshmi Nagar, Bhavani", 90, "U3"),
  C("C017", "Dinesh Kumar", "9842216503", "Erode", "19, Veerappan Chatram, Erode", 120, "U3"),
  C("C018", "Kumaresan", "9715140928", "Chennimalai", "4, Weavers Colony, Chennimalai", 210, "U2"),
  C("C019", "Lakshmi Narayanan", "9092351874", "Gobichettipalayam", "10, Modachur Road, Gobi", 100, "U3"),
  C("C020", "Mohan Raj", "9994421036", "Perundurai", "23, Railway Station Road, Perundurai", 75, "U2"),
];

const jewel = (description: string, weightGrams: number, purity: string, estimatedValue: number, packetNo: string, notes?: string): Security => ({
  kind: "jewel",
  description,
  weightGrams,
  purity,
  estimatedValue: rupees(estimatedValue),
  packetNo,
  storage: "Office locker A",
  notes,
  status: "held",
});

const vehicle = (
  registration: string,
  vehicleType: "car" | "bike" | "commercial" | "other",
  make: string,
  model: string,
  ownerName: string,
  rcRef: string,
): Security => ({
  kind: "vehicle",
  registration,
  vehicleType,
  make,
  model,
  ownerName,
  rcRef,
  documentHeld: "Original RC + spare key",
  storage: "Office file cabinet 2",
  status: "held",
});

const STORY_LOANS: LoanSpec[] = [
  // Most loans are INTEREST-ONLY: the customer pays interest every period and returns
  // the principal later. A few show partial principal payments and full settlements.

  // Ravi — main demo customer: monthly interest, with two past partial principal payments.
  { id: "LP-1024", customerId: "C001", type: "monthly", amount: 200000, frequency: "monthly", interest: pct(3), cycles: 8, dueOffset: 0, extraPrincipal: { 3: 50000, 5: 30000 }, reference: "Shop stock" },
  { id: "LP-1147", customerId: "C001", type: "vehicle", amount: 100000, frequency: "monthly", interest: pct(2), cycles: 7, dueOffset: 4, security: vehicle("TN 56 AR 4521", "bike", "Royal Enfield", "Classic 350", "Ravi Kumar", "RC-56-2211") },
  // Murugan — vehicle-backed, interest overdue.
  { id: "LP-1088", customerId: "C002", type: "vehicle", amount: 150000, frequency: "monthly", interest: pct(3, "fixed"), cycles: 5, dueOffset: -3, security: vehicle("TN 33 AB 1234", "commercial", "Mahindra", "Bolero Pik-Up", "Murugan S", "RC-33-8812") },
  { id: "LP-1102", customerId: "C003", type: "weekly", amount: 100000, frequency: "weekly", interest: fixed(2500), cycles: 6, dueOffset: 0 },
  { id: "LP-1131", customerId: "C004", type: "30day", amount: 300000, frequency: "30days", interest: pct(6, "fixed"), cycles: 2, dueOffset: -5 },
  // Selvam — jewel loan: half this period's interest paid yesterday (PARTIAL); returned ₹50,000 principal earlier.
  { id: "LP-1066", customerId: "C005", type: "jewel", amount: 150000, frequency: "monthly", interest: pct(3), cycles: 4, dueOffset: 0, extraPrincipal: { 3: 50000 }, partial: { amount: 1500, offset: -1 }, security: jewel("Gold Chain + Ring", 38.5, "22K", 285000, "PKT-0412", "Chain 30.2 g, ring 8.3 g") },
  // Karthik — the live partial-payment demo: ₹10,000 interest due today.
  { id: "LP-1152", customerId: "C006", type: "15day", amount: 500000, frequency: "15days", interest: fixed(10000), cycles: 1, dueOffset: 0 },
  // Prabhu — rescheduled from today.
  { id: "LP-1119", customerId: "C007", type: "monthly", amount: 120000, frequency: "monthly", interest: pct(2.5), cycles: 5, dueOffset: 0, reschedule: { toOffset: 5, reason: "Travelling to Coimbatore, will pay on return" } },
  { id: "LP-1160", customerId: "C008", type: "weekly", amount: 80000, frequency: "weekly", interest: fixed(2000), cycles: 3, dueOffset: 0, paidToday: true },
  { id: "LP-1049", customerId: "C008", type: "weekly", amount: 40000, frequency: "weekly", interest: fixed(1000), cycles: 10, dueOffset: 0, closedDaysAgo: 5 },
  { id: "LP-1075", customerId: "C009", type: "monthly", amount: 500000, frequency: "monthly", interest: pct(2), cycles: 10, dueOffset: 0, paidToday: true, reference: "Business expansion" },
  { id: "LP-1170", customerId: "C009", type: "30day", amount: 100000, frequency: "30days", interest: pct(5, "fixed"), cycles: 0, dueOffset: 3 },
  { id: "LP-1063", customerId: "C009", type: "30day", amount: 200000, frequency: "30days", interest: pct(5, "fixed"), cycles: 3, dueOffset: 0, closedDaysAgo: 40 },
  { id: "LP-1093", customerId: "C010", type: "vehicle", amount: 250000, frequency: "monthly", interest: pct(1.5), cycles: 9, dueOffset: -12, security: vehicle("TN 56 C 7788", "commercial", "Tata", "Ace Gold", "Rajesh N", "RC-56-4410") },
  { id: "LP-1019", customerId: "C010", type: "vehicle", amount: 120000, frequency: "monthly", interest: pct(2), cycles: 9, dueOffset: 0, closedDaysAgo: 3, security: vehicle("TN 56 B 3310", "bike", "Bajaj", "Pulsar 220", "Rajesh N", "RC-56-1187") },
  { id: "LP-1110", customerId: "C011", type: "weekly", amount: 60000, frequency: "weekly", interest: fixed(1500), cycles: 5, dueOffset: 0, paidToday: true },
  { id: "LP-1012", customerId: "C012", type: "monthly", amount: 80000, frequency: "monthly", interest: pct(2.5), cycles: 8, dueOffset: 0, closedDaysAgo: 62 },
  { id: "LP-1139", customerId: "C013", type: "jewel", amount: 120000, frequency: "monthly", interest: pct(2), cycles: 3, dueOffset: -38, security: jewel("Gold Necklace", 52, "22K", 390000, "PKT-0433") },
  // Senthil — last month's interest was paid on time but entered late (BACKDATED entry).
  { id: "LP-1101", customerId: "C014", type: "monthly", amount: 200000, frequency: "monthly", interest: pct(2.5), cycles: 7, dueOffset: 0, backdated: { cycle: 7, recordedDaysAgo: 1 }, security: { kind: "document", documentType: "Property Sale Deed", owner: "Senthil V", referenceNo: "SD-1187/2019", original: true, description: "House site, Kodumudi — 3 cents", storage: "Office locker B", status: "held" } },
  { id: "LP-1175", customerId: "C015", type: "15day", amount: 20000, frequency: "15days", interest: fixed(800), cycles: 0, dueOffset: -2 },
  { id: "LP-1044", customerId: "C016", type: "vehicle", amount: 60000, frequency: "monthly", interest: pct(2), cycles: 3, dueOffset: 2, security: vehicle("TN 36 AK 9021", "bike", "Honda", "Shine 125", "Balamurugan T", "RC-36-7730") },
  { id: "LP-1125", customerId: "C017", type: "weekly", amount: 200000, frequency: "weekly", interest: fixed(5000), cycles: 4, dueOffset: 0 },
  // Dinesh — returned ₹25,000 principal this month (partial principal).
  { id: "LP-1163", customerId: "C017", type: "monthly", amount: 100000, frequency: "monthly", interest: pct(2.5), cycles: 1, dueOffset: 10, extraPrincipal: { 1: 25000 } },
  { id: "LP-1057", customerId: "C018", type: "monthly", amount: 300000, frequency: "monthly", interest: pct(3), cycles: 2, dueOffset: -65 },
  { id: "LP-1142", customerId: "C019", type: "jewel", amount: 45000, frequency: "monthly", interest: pct(2), cycles: 2, dueOffset: 0, paidToday: true, security: jewel("Gold Bangles (pair)", 24, "22K", 175000, "PKT-0457") },
  { id: "LP-1031", customerId: "C019", type: "jewel", amount: 60000, frequency: "monthly", interest: pct(2), cycles: 5, dueOffset: 0, closedDaysAgo: 12, released: true, security: jewel("Gold Chain", 18, "22K", 160000, "PKT-0398") },
  { id: "LP-1098", customerId: "C020", type: "30day", amount: 60000, frequency: "30days", interest: pct(5, "fixed"), cycles: 1, dueOffset: -9 },
];

// ---------------------------------------------------------------------------
// Generated customers (fill the book so lists and totals feel real)
// ---------------------------------------------------------------------------

const EXTRA_NAMES = [
  "Ganesan K", "Palanisamy", "Arumugam R", "Karuppusamy", "Ramesh Babu", "Elango", "Sivakumar", "Velmurugan",
  "Anbarasan", "Kannan S", "Duraisamy", "Jayakumar", "Muthusamy", "Parthiban", "Rameshkumar", "Thangaraj",
  "Chinnasamy", "Venkatesh", "Sakthivel", "Periyasamy", "Ilango", "Nagarajan", "Kathiresan", "Sundaram",
  "Boopathi", "Mahendran", "Senthilkumar A", "Kalaiselvan", "Prakash M", "Subramani", "Govindaraj", "Loganathan",
  "Tamilselvan", "Rajkumar P", "Ashok Kumar", "Vasanth", "Murali", "Selvaraj", "Anand K", "Chandrasekar",
];
const AREAS = ["Perundurai", "Erode", "Bhavani", "Chennimalai", "Gobichettipalayam", "Kanjikoil", "Tiruppur", "Kodumudi", "Modakurichi", "Ingur", "Vijayamangalam", "Sivagiri"];
const STREETS = ["Main Road", "Bazaar Street", "Temple Street", "Nehru Nagar", "Anna Nagar", "Kamarajar Street", "Bharathi Nagar", "Station Road"];
const JEWELS: [string, number][] = [["Gold Chain", 16], ["Gold Bangle", 12.5], ["Gold Earrings + Chain", 21], ["Gold Necklace", 34], ["Gold Rings (3)", 9.8]];
const BIKES: [string, string][] = [["Hero", "Splendor Plus"], ["TVS", "Apache RTR"], ["Bajaj", "Pulsar 150"], ["Honda", "Activa 6G"], ["Yamaha", "FZ-S"]];
const CARS: [string, string][] = [["Maruti Suzuki", "Swift"], ["Hyundai", "i20"], ["Tata", "Nexon"], ["Toyota", "Innova"]];

function generated(r: () => number) {
  const customers: ReturnType<typeof C>[] = [];
  const loans: LoanSpec[] = [];
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  let loanNo = 1180;
  EXTRA_NAMES.forEach((name, i) => {
    const id = `C${String(21 + i).padStart(3, "0")}`;
    const area = pick(AREAS);
    const phone = `9${Math.floor(100000000 + r() * 899999999)}`;
    customers.push(C(id, name, phone, area, `${1 + Math.floor(r() * 60)}, ${pick(STREETS)}, ${area}`, 30 + Math.floor(r() * 500), r() > 0.5 ? "U2" : "U3"));
    const kindRoll = r();
    // Spread due dates: mostly upcoming, a few due today / overdue.
    const dueOffset = i % 5 === 0 ? 0 : i % 7 === 0 ? -(4 + Math.floor(r() * 20)) : 1 + Math.floor(r() * 26);
    const base = { id: `LP-${loanNo++}`, customerId: id, cycles: 1 + Math.floor(r() * 6), dueOffset, paidToday: dueOffset === 0 && i % 2 === 0 };
    if (kindRoll < 0.28) {
      const amount = 20000 + Math.round(r() * 8) * 5000;
      loans.push({ ...base, type: "weekly", amount, frequency: "weekly", interest: fixed(Math.round(amount * 0.025)) });
    } else if (kindRoll < 0.58) {
      const amount = 150000 + Math.round(r() * 13) * 50000;
      loans.push({ ...base, type: "monthly", amount, frequency: "monthly", interest: pct(pick([2, 2.5, 3])) });
    } else if (kindRoll < 0.72) {
      const [desc, g] = JEWELS[i % JEWELS.length];
      const amount = Math.round((g * 5200) / 1000) * 1000;
      loans.push({ ...base, type: "jewel", amount, frequency: "monthly", interest: pct(2), security: jewel(desc, g, pick(["22K", "22K", "18K"]), Math.round(g * 9100), `PKT-0${480 + i}`) });
    } else if (kindRoll < 0.86) {
      const isCar = r() > 0.55;
      const [make, model] = isCar ? pick(CARS) : pick(BIKES);
      const amount = isCar ? 200000 + Math.round(r() * 8) * 25000 : 40000 + Math.round(r() * 6) * 5000;
      const reg = `TN ${pick(["33", "56", "36"])} ${String.fromCharCode(65 + Math.floor(r() * 26))}${String.fromCharCode(65 + Math.floor(r() * 26))} ${1000 + Math.floor(r() * 8999)}`;
      loans.push({ ...base, type: "vehicle", amount, frequency: "monthly", interest: pct(2), security: vehicle(reg, isCar ? "car" : "bike", make, model, name, `RC-${reg.slice(3, 5)}-${1000 + i * 37}`) });
    } else {
      const amount = 100000 + Math.round(r() * 10) * 25000;
      loans.push({ ...base, type: pick(["30day", "15day"] as const), amount, frequency: r() > 0.5 ? "30days" : "15days", interest: pct(4, "fixed") });
    }
  });
  return { customers, loans };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const METHODS: PaymentMethod[] = ["cash", "cash", "cash", "upi", "upi", "bank"];

export function buildDemoDB(today: ISODate): DemoDB {
  const r = rng(20260928);
  const gen = generated(r);
  const customerSpecs = [...STORY_CUSTOMERS, ...gen.customers];
  const loanSpecs = [...STORY_LOANS, ...gen.loans];

  const customers: Customer[] = customerSpecs.map(({ createdDaysAgo, ...c }) => ({
    ...c,
    createdAt: shiftISO(today, -createdDaysAgo),
  }));

  const loans: Loan[] = [];
  const dues: Due[] = [];
  const payments: Payment[] = [];
  let pay = 1;
  let dueNo = 1;
  const pid = () => `P${String(pay++).padStart(5, "0")}`;
  const did = () => `D${String(dueNo++).padStart(5, "0")}`;

  // The next collection is never more than one period away (otherwise the history
  // built below would contain payments dated in the future).
  const PERIOD_DAYS = { weekly: 7, "15days": 15, "30days": 30, monthly: 28, custom: 30 } as const;

  for (const spec of loanSpecs) {
    const s: LoanSpec = {
      ...spec,
      amount: rupees(spec.amount),
      interest: spec.interest.style === "percent" ? spec.interest : { ...spec.interest, value: rupees(spec.interest.value) },
      principalPerDue: rupees(spec.principalPerDue ?? 0),
      extraPrincipal: spec.extraPrincipal && Object.fromEntries(Object.entries(spec.extraPrincipal).map(([k, v]) => [k, rupees(v)])),
      partial: spec.partial && { ...spec.partial, amount: rupees(spec.partial.amount) },
    };
    const dueOffset = Math.min(s.dueOffset, PERIOD_DAYS[s.frequency] - 1);
    const targetDue = shiftISO(today, s.closedDaysAgo ? -s.closedDaysAgo : dueOffset);
    const startDate = previousDueDate(targetDue, s.frequency, s.cycles + 1);
    let loan: Loan = {
      id: s.id,
      customerId: s.customerId,
      type: s.type,
      amount: s.amount,
      startDate,
      reference: s.reference,
      interest: s.interest,
      frequency: s.frequency,
      principalPerDue: s.principalPerDue ?? 0,
      principalLeft: s.amount,
      status: "active",
      security: s.security ?? null,
    };
    let loanDues: Due[] = [];
    const first = buildDue(loan, previousDueDate(targetDue, s.frequency, s.cycles), did());
    loanDues.push(first);

    const receive = (date: ISODate, interest: number, principal: number, recordedOn?: ISODate, note?: string) => {
      const res = applyPayment(
        loan,
        loanDues,
        // history is replayed as it happened: each payment goes to the collection then open
        { loanId: loan.id, dueId: openDue(loanDues)?.id, date, recordedOn: recordedOn ?? date, interest, principal, other: 0, method: METHODS[Math.floor(r() * METHODS.length)], note },
        { paymentId: pid(), nextDueId: did() },
        // "today" for a past payment is the day it was made, so no later period exists yet
        date,
      );
      loan = res.loan;
      loanDues = res.dues;
      payments.push(res.payment);
    };

    // Completed history: each open due paid in full, sometimes a day or two late.
    for (let cycle = 1; cycle <= s.cycles; cycle++) {
      const due = openDue(loanDues);
      if (!due) break;
      const late = r() < 0.25 ? 1 + Math.floor(r() * 2) : 0;
      const extra = s.extraPrincipal?.[cycle] ?? 0;
      const back = s.backdated?.cycle === cycle;
      const paidOn = shiftISO(due.dueDate, back ? 0 : late);
      receive(
        paidOn > today ? today : paidOn,
        due.interestAmount,
        due.principalAmount + extra,
        back ? shiftISO(today, -s.backdated!.recordedDaysAgo) : undefined,
        back ? "Paid at Kodumudi, entered late" : undefined,
      );
    }

    if (s.closedDaysAgo) {
      const due = openDue(loanDues);
      if (due) receive(due.dueDate, due.interestAmount, loan.principalLeft);
      if (s.released && loan.security) loan = { ...loan, security: { ...loan.security, status: "released" } };
    } else {
      // Pin the current due to exactly the requested day (month lengths can drift).
      const due = openDue(loanDues);
      if (due) {
        due.dueDate = targetDue;
        if (s.partial) {
          const interest = Math.min(s.partial.amount, due.interestAmount);
          receive(shiftISO(today, s.partial.offset), interest, s.partial.amount - interest);
        } else if (s.paidToday) {
          receive(today, due.interestAmount, due.principalAmount);
        } else if (s.reschedule) {
          due.rescheduled = { originalDate: due.dueDate, reason: s.reschedule.reason };
          due.dueDate = shiftISO(today, s.reschedule.toOffset);
        }
      }
    }

    // Bring the loan up to today: every period missed since its last collection is pending.
    loanDues = accrueDues(loan, loanDues, today, did);

    loans.push(loan);
    dues.push(...loanDues);
  }

  return { customers, loans, dues, payments, activity: seedActivity(today), users: DEMO_USERS };
}

function seedActivity(today: ISODate): Activity[] {
  const at = (h: number, m: number, dayOffset = 0) => `${shiftISO(today, dayOffset)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  return [
    { id: "A7", at: at(11, 20), by: "Mani", text: "Received ₹1,500 from Manikandan · LP-1110", kind: "payment" },
    { id: "A6", at: at(10, 5), by: "Rajendran", text: "Received ₹10,000 from Saravanan P · LP-1075", kind: "payment" },
    { id: "A5", at: at(9, 40), by: "Kavin", text: "Received ₹2,000 from Vignesh K · LP-1160", kind: "payment" },
    { id: "A4", at: at(9, 15), by: "Rajendran", text: "Moved Prabhu M's payment to a later date", kind: "reschedule" },
    { id: "A3", at: at(19, 10, -1), by: "Kavin", text: "Recorded a backdated payment from Senthil V · LP-1101 (paid last month)", kind: "payment" },
    { id: "A2", at: at(18, 30, -1), by: "Mani", text: "Received ₹1,500 part interest from Selvam · LP-1066", kind: "payment" },
    { id: "A1", at: at(17, 5, -1), by: "Rajendran", text: "Logged in from a new device (Chrome · Windows)", kind: "system" },
  ];
}
