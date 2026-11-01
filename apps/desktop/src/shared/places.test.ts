import { describe, expect, it } from 'vitest';
import { placesIn, savedPlaces } from './places.ts';

describe('placesIn', () => {
  it.each([
    ['Chicago', ['Chicago']],
    ['Chicago, IL', ['Chicago, IL']],
    ['chicago, il', ['chicago, il']],
    [' Chicago ,  IL ', ['Chicago, IL']],
    ['Chicago, Denver', ['Chicago', 'Denver']],
    ['Chicago, IL, Denver, CO', ['Chicago, IL', 'Denver, CO']],
    ['Chicago, IL\nDenver, CO', ['Chicago, IL', 'Denver, CO']],
    ['Columbus, Ohio', ['Columbus, Ohio']],
    ['New York, NY', ['New York, NY']],
    ['New York City, New York', ['New York City, New York']],
    ['Washington, DC', ['Washington, DC']],
    ['New Orleans, LA', ['New Orleans, LA']],
    ['Toronto, ON', ['Toronto, ON']],
    ['Toronto, Canada', ['Toronto, Canada']],
    ['London, UK', ['London, UK']],
    ['Paris, France', ['Paris, France']],
    ['Dublin, Ireland', ['Dublin, Ireland']],
    ['Munich, Germany, Paris, France', ['Munich, Germany', 'Paris, France']],
    ['Ohio, Michigan', ['Ohio', 'Michigan']],
    ['New York, New Jersey', ['New York', 'New Jersey']],
    ['France, Germany', ['France', 'Germany']],
    ['OH, MI', ['OH', 'MI']],
    ['IL', ['IL']],
    [',, Chicago,', ['Chicago']],
    ['', []],
  ])('reads %j as %j', (text, places) => {
    expect(placesIn(text)).toEqual(places);
  });
});

describe('savedPlaces', () => {
  it.each([
    // A comma used to split them.
    [
      ['Chicago', 'IL', 'Dublin', 'OH', 'Tulsa', 'OK'],
      ['Chicago, IL', 'Dublin, OH', 'Tulsa, OK'],
    ],
    [['Portland', 'or'], ['Portland, or']],
    [['Toronto', 'ON'], ['Toronto, ON']],
    [['New York', 'NY'], ['New York, NY']],
    [['Washington', 'DC'], ['Washington, DC']],
    // Two places, each told on its own.
    [
      ['San Francisco', 'New York'],
      ['San Francisco', 'New York'],
    ],
    [
      ['Baltimore', 'Washington'],
      ['Baltimore', 'Washington'],
    ],
    [
      ['Boston', 'DC'],
      ['Boston', 'DC'],
    ],
    [
      ['NYC', 'LA'],
      ['NYC', 'LA'],
    ],
    [
      ['Chicago', 'NY'],
      ['Chicago', 'NY'],
    ],
    [
      ['Canada', 'UK'],
      ['Canada', 'UK'],
    ],
    [
      ['Chicago', 'Denver'],
      ['Chicago', 'Denver'],
    ],
    [
      ['Ohio', 'MI'],
      ['Ohio', 'MI'],
    ],
    [
      ['OH', 'MI'],
      ['OH', 'MI'],
    ],
    // With LA, NY and DC being cities too, these stay apart, which only adds a search.
    [
      ['New Orleans', 'LA'],
      ['New Orleans', 'LA'],
    ],
    [
      ['Albany', 'NY'],
      ['Albany', 'NY'],
    ],
    // So do these, for a city that names its state.
    [
      ['Columbus', 'Ohio'],
      ['Columbus', 'Ohio'],
    ],
    [
      ['Paris', 'France'],
      ['Paris', 'France'],
    ],
    // Already whole.
    [
      ['Columbus, OH', 'IL'],
      ['Columbus, OH', 'IL'],
    ],
    [[], []],
  ])('reads %j as %j', (places, read) => {
    expect(savedPlaces(places)).toEqual(read);
  });
});
