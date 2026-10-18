import { describe, expect, it } from 'vitest';
import { FREE_SYNC_EMAIL, SYNC_PRICE, SYNC_PRICE_WORDS } from './site.ts';

describe('what the app and the web view say about sync', () => {
  it('says the price as its two Stripe prices are set', () => {
    expect(SYNC_PRICE_WORDS).toBe(`$${SYNC_PRICE.month} a month or $${SYNC_PRICE.year} a year`);
    // Paying yearly costs less than paying monthly for a year.
    expect(SYNC_PRICE.year).toBeLessThan(SYNC_PRICE.month * 12);
  });

  it('asks for free sync at an address, not a page', () => {
    expect(FREE_SYNC_EMAIL).toMatch(/^[^@\s]+@factwright\.com$/);
  });
});
