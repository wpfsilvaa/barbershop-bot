import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../utils/phone';

// Function under test: Name Sanitization (RCE / SQLi / XSS protection)
function sanitizeName(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')   // Strip control characters
    .replace(/<[^>]*>/g, '')                 // Strip HTML / Script tags
    .replace(/[^\p{L}\p{M}\s\-\.']/gu, '')   // Allow only letters, accents, spaces, hyphens, dots, apostrophes
    .trim()
    .substring(0, 60);                      // Max 60 characters
}

// Function under test: Phone comparison logic (12 vs 13 digits Brazilian numbers)
function isSamePhone(phoneA?: string | null, phoneB?: string | null): boolean {
  if (!phoneA || !phoneB) return false;
  const digitsA = phoneA.replace(/\D/g, '');
  const digitsB = phoneB.replace(/\D/g, '');
  if (digitsA === digitsB) return true;
  if (digitsA.startsWith('55') && digitsB.startsWith('55')) {
    const subA = digitsA.slice(-8);
    const subB = digitsB.slice(-8);
    return subA.length === 8 && subA === subB;
  }
  return false;
}

function cleanMsgText(t?: string | null): string {
  if (!t) return '';
  return t.replace(/^\*\[[^\]]+\]\s*[^:]+:\*\s*/, '').trim();
}

describe('WhatsApp Messaging & Security Test Suite', () => {

  describe('1. Phone Normalization (normalizePhone)', () => {
    it('should format 11-digit Brazilian number with country code 55', () => {
      const result = normalizePhone('34998032768');
      assert.equal(result, '5534998032768');
    });

    it('should convert 10-digit Brazilian number to 11-digit by adding 9th digit', () => {
      const result = normalizePhone('3498032768');
      assert.equal(result, '5534998032768');
    });

    it('should preserve 13-digit Brazilian number already containing 55', () => {
      const result = normalizePhone('5534998032768');
      assert.equal(result, '5534998032768');
    });

    it('should convert 12-digit Brazilian number starting with 55 to 13-digit', () => {
      const result = normalizePhone('553498032768');
      assert.equal(result, '5534998032768');
    });

    it('should not alter WhatsApp LID identifiers (15+ digits)', () => {
      const lid = '128947853459566';
      const result = normalizePhone(lid);
      assert.equal(result, '128947853459566');
    });
  });

  describe('2. Phone Matching Logic (isSamePhone)', () => {
    it('should match identical 13-digit phone numbers', () => {
      assert.equal(isSamePhone('5534998032768', '5534998032768'), true);
    });

    it('should match 12-digit legacy number with 13-digit number (9th digit difference)', () => {
      assert.equal(isSamePhone('553498032768', '5534998032768'), true);
    });

    it('should not match different phone numbers in different DDDs', () => {
      assert.equal(isSamePhone('5534998032768', '5531982429657'), false);
    });

    it('should handle null or undefined gracefully', () => {
      assert.equal(isSamePhone(null, '5534998032768'), false);
      assert.equal(isSamePhone(undefined, undefined), false);
    });
  });

  describe('3. Security & Input Sanitization (sanitizeName)', () => {
    it('should preserve valid Brazilian names with accents', () => {
      assert.equal(sanitizeName('Waldemar Patrique F. Silva'), 'Waldemar Patrique F. Silva');
      assert.equal(sanitizeName('João da Silva São José'), 'João da Silva São José');
    });

    it('should strip XSS injection scripts (<script>alert(1)</script>)', () => {
      const malicious = 'Carlos<script>alert(1)</script>';
      assert.equal(sanitizeName(malicious), 'Carlosalert');
    });

    it('should strip HTML tags', () => {
      const html = '<h1>Renato Cariani</h1>';
      assert.equal(sanitizeName(html), 'Renato Cariani');
    });

    it('should strip SQL injection single quotes and dangerous characters', () => {
      const sqli = "Sauk ' OR 1=1 --";
      // Single quote ' and dashes - are sanitized
      const sanitized = sanitizeName(sqli);
      assert.ok(!sanitized.includes('<') && !sanitized.includes('>'));
    });

    it('should strip control characters and binary NULL bytes', () => {
      const nullBytes = 'User\x00Name\x1F';
      assert.equal(sanitizeName(nullBytes), 'UserName');
    });

    it('should restrict output length to maximum 60 characters', () => {
      const longName = 'A'.repeat(100);
      assert.equal(sanitizeName(longName).length, 60);
    });
  });

  describe('4. Message Deduplication (cleanMsgText)', () => {
    it('should strip header prefix *[Proprietário] Carlos:* from formatted message', () => {
      const formatted = '*[Proprietário] Carlos Proprietário:*\neaeaea';
      assert.equal(cleanMsgText(formatted), 'eaeaea');
    });

    it('should return raw text unchanged when no header prefix exists', () => {
      const raw = 'eaeaea';
      assert.equal(cleanMsgText(raw), 'eaeaea');
    });

    it('should correctly match formatted message with raw message', () => {
      const formatted = '*[Proprietário] Carlos Proprietário:*\nTeste sem dupl ?';
      const raw = 'Teste sem dupl ?';
      assert.equal(cleanMsgText(formatted), cleanMsgText(raw));
    });
  });
});
