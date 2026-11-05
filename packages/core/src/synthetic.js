// Seeded synthetic applicant generator for tests and the evaluation script. All data is fake.
import { verhoeffCheckDigit } from './verhoeff.js';

const FIRST = ['Aarav', 'Diya', 'Vihaan', 'Anaya', 'Reyansh', 'Ishita', 'Kabir', 'Meera', 'Arjun', 'Saanvi', 'Rohan', 'Nisha'];
const LAST = ['Mehta', 'Sharma', 'Iyer', 'Reddy', 'Khan', 'Das', 'Patel', 'Singh', 'Nair', 'Gupta', 'Joshi', 'Bose'];
const PREFIXES = ['110', '121', '201', '226', '302', '380', '400', '411', '500', '560', '600', '700', '695', '751', '834', '793'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function generateProfile(rng) {
  const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (a) => a[int(0, a.length - 1)];
  const digits = (n) => Array.from({ length: n }, () => int(0, 9)).join('');
  const gauss = () => Math.sqrt(-2 * Math.log(rng())) * Math.cos(2 * Math.PI * rng());
  const round = (x, step) => Math.round(x / step) * step;

  const first = pick(FIRST);
  const last = pick(LAST);
  const aadhaarBase = String(int(2, 9)) + digits(10);
  const pan = Array.from({ length: 5 }, () => pick([...LETTERS])).join('') + digits(4) + pick([...LETTERS]);
  const phone = String(int(6, 9)) + digits(9);
  const email = `${first}.${last}${int(1, 99)}@example.com`.toLowerCase();

  const income = Math.min(400000, Math.max(12000, round(Math.exp(10.9 + 0.65 * gauss()), 500)));
  const monthlyEmi = rng() < 0.25 ? 0 : round(income * rng() ** 2 * 0.7, 500);
  const hasCards = rng() < 0.6;
  const creditCardLimit = hasCards ? round(income * (2 + rng() * 4), 5000) : 0;
  const creditCardOutstanding = hasCards ? round(creditCardLimit * rng() ** 1.5, 500) : 0;
  const r = rng();
  const employmentType = r < 0.65 ? 'salaried' : r < 0.9 ? 'self_employed' : 'other';

  const n = rng();
  const notes = n < 0.4 ? ''
    : n < 0.7 ? 'Looking to consolidate existing debt.'
      : `Reach me on ${phone} or ${email}. PAN ${pan}.`;

  return {
    fullName: `${first} ${last}`,
    aadhaar: aadhaarBase + verhoeffCheckDigit(aadhaarBase),
    pan, phone, email,
    dob: `${int(1958, 2004)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
    pincode: pick(PREFIXES) + digits(3),
    monthlyIncome: income, monthlyEmi, creditCardLimit, creditCardOutstanding,
    employmentType,
    loanAmount: int(5, 200) * 10000,
    tenureMonths: pick([12, 24, 36, 48, 60]),
    notes,
  };
}
