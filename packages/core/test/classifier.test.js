import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyField, classifyProfile, scanText, verhoeffValid, verhoeffCheckDigit, SAMPLE_PROFILE, SAMPLE_AADHAAR,
} from '../src/index.js';

test('verhoeff: generated check digit validates, tampered one does not', () => {
  assert.ok(verhoeffValid(SAMPLE_AADHAAR));
  const bad = SAMPLE_AADHAAR.slice(0, 11) + ((+SAMPLE_AADHAAR[11] + 1) % 10);
  assert.ok(!verhoeffValid(bad));
  assert.equal(verhoeffCheckDigit('236'), '3'); // known Verhoeff test vector
});

test('aadhaar: valid checksum -> critical, high confidence; works with spaces', () => {
  const spaced = `${SAMPLE_AADHAAR.slice(0, 4)} ${SAMPLE_AADHAAR.slice(4, 8)} ${SAMPLE_AADHAAR.slice(8)}`;
  const c = classifyField('aadhaar', spaced);
  assert.equal(c.primary, 'aadhaar');
  assert.equal(c.sensitivity, 4);
  assert.ok(c.confidence >= 0.98);
});

test('aadhaar-shaped number without name hint is still caught by value, with lower confidence on bad checksum', () => {
  const bad = SAMPLE_AADHAAR.slice(0, 11) + ((+SAMPLE_AADHAAR[11] + 1) % 10);
  const c = classifyField('field17', bad);
  assert.equal(c.primary, 'aadhaar');
  assert.ok(c.confidence < 0.7);
});

test('pan, phone, email, name, dob, pincode', () => {
  assert.equal(classifyField('pan', 'ABCDE1234F').primary, 'pan');
  assert.equal(classifyField('contact', '+91 98765 43210').primary, 'phone');
  assert.equal(classifyField('x', 'a.b@example.com').primary, 'email');
  assert.equal(classifyField('fullName', 'Aarav Mehta').primary, 'name');
  assert.equal(classifyField('dob', '1994-03-15').primary, 'dob');
  assert.equal(classifyField('pincode', '560034').primary, 'pincode');
});

test('financial and service attributes are recognised from names', () => {
  for (const k of ['monthlyIncome', 'monthlyEmi', 'creditCardLimit', 'creditCardOutstanding']) {
    const c = classifyField(k, 12345);
    assert.equal(c.category, 'financial', k);
    assert.equal(c.sensitivity, 3, k);
  }
  assert.equal(classifyField('loanAmount', 500000).sensitivity, 1);
  assert.equal(classifyField('tenureMonths', 36).sensitivity, 1);
  assert.equal(classifyField('employmentType', 'salaried').sensitivity, 1);
});

test('free text: embedded PII detected and located; clean text is not sensitive', () => {
  const c = classifyField('notes', 'Call 9876543210, PAN ABCDE1234F');
  assert.equal(c.category, 'free_text_pii');
  assert.ok(c.sensitivity >= 3);
  assert.deepEqual(c.findings.map((f) => f.id).sort(), ['pan', 'phone']);
  const clean = classifyField('notes', 'Looking to consolidate debt');
  assert.equal(clean.sensitivity, 0);
});

test('scanText resolves overlaps (12-digit with 91 prefix reported once)', () => {
  const found = scanText('call 919876543210 now');
  assert.equal(found.length, 1);
});

test('sample profile classification matches expectations', () => {
  const cls = classifyProfile(SAMPLE_PROFILE);
  assert.equal(cls.aadhaar.sensitivity, 4);
  assert.equal(cls.fullName.category, 'direct_identifier');
  assert.equal(cls.dob.category, 'quasi_identifier');
  assert.equal(cls.notes.category, 'free_text_pii');
  assert.equal(cls.loanAmount.sensitivity, 1);
});
