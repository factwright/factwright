import { describe, expect, it } from 'vitest';
import { joinPlaces, placesIn } from './places.ts';

describe('joinPlaces', () => {
  it.each([
    [
      ['Chicago', 'IL', 'Dublin', 'OH', 'Tulsa', 'OK'],
      ['Chicago, IL', 'Dublin, OH', 'Tulsa, OK'],
    ],
    [['Columbus', 'Ohio'], ['Columbus, Ohio']],
    [['Portland', 'or'], ['Portland, or']],
    [
      ['Toronto', 'ON', 'London', 'UK'],
      ['Toronto, ON', 'London, UK'],
    ],
    [['New York', 'NY'], ['New York, NY']],
    [['New York City', 'New York'], ['New York City, New York']],
    [['Washington', 'DC'], ['Washington, DC']],
    [
      ['Chicago', 'Denver'],
      ['Chicago', 'Denver'],
    ],
    [
      ['Paris', 'France'],
      ['Paris', 'France'],
    ],
    [
      ['Ohio', 'Michigan'],
      ['Ohio', 'Michigan'],
    ],
    [
      ['New York', 'New Jersey'],
      ['New York', 'New Jersey'],
    ],
    [
      ['OH', 'MI'],
      ['OH', 'MI'],
    ],
    [['IL'], ['IL']],
    [
      ['Columbus, OH', 'IL'],
      ['Columbus, OH', 'IL'],
    ],
    [[], []],
  ])('joins %j into %j', (places, joined) => {
    expect(joinPlaces(places)).toEqual(joined);
  });
});

describe('placesIn', () => {
  it.each([
    ['Chicago', ['Chicago']],
    ['Chicago, IL', ['Chicago, IL']],
    [' Chicago ,  IL ', ['Chicago, IL']],
    ['Chicago, Denver', ['Chicago', 'Denver']],
    ['Chicago, IL, Denver, CO', ['Chicago, IL', 'Denver, CO']],
    ['Chicago, IL\nDenver, CO', ['Chicago, IL', 'Denver, CO']],
    ['Columbus, Ohio', ['Columbus, Ohio']],
    [',, Chicago,', ['Chicago']],
    ['', []],
  ])('reads %j as %j', (text, places) => {
    expect(placesIn(text)).toEqual(places);
  });
});
