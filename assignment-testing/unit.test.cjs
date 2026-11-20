require('reflect-metadata');
const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { CreatePostDto, NearbyQuery } = require('../apps/api/dist/common/dtos');
const form = {
  title: ' Study Group ', description: ' Review chapter one. ', category: 'Social',
  placeName: ' Library ', latitude: '41', longitude: '-80', activityAt: '2026-12-01T12:00:00Z',
};

describe('U3 - CreatePostDto: activity form validation', () => {
  // Checks that a valid form trims text and converts coordinate strings.
  test('U3-01 accepts and normalizes a valid Study Group form', async t => {
    const input = plainToInstance(CreatePostDto, form);
    const errors = await validate(input);
    assert.equal(errors.length, 0);
    assert.equal(input.title, 'Study Group');
    assert.equal(input.placeName, 'Library');
    assert.equal(input.latitude, 41);
    t.diagnostic(JSON.stringify({ id: 'U3-01', actual: errors.length, expected: 0 }));
  });

  // Checks the inclusive 100-character activity-title limit.
  test('U3-02 accepts a title exactly 100 characters long', async t => {
    const input = plainToInstance(CreatePostDto, { ...form, title: 'S'.repeat(100) });
    const errors = await validate(input);
    assert.equal(input.title.length, 100);
    assert.equal(errors.length, 0);
    t.diagnostic(JSON.stringify({ id: 'U3-02', actual: errors.length, expected: 0 }));
  });

  // Checks that spaces cannot satisfy the required title.
  test('U3-03 rejects a whitespace-only title', async t => {
    const errors = await validate(plainToInstance(CreatePostDto, { ...form, title: '   ' }));
    assert.equal(errors.length, 1);
    assert.equal(errors[0].property, 'title');
    assert.equal(errors[0].constraints.minLength, 'Activity title is required');
    t.diagnostic(JSON.stringify({ id: 'U3-03', actual: errors[0].constraints.minLength, expected: 'Activity title is required' }));
  });
});

describe('U4 - NearbyQuery: discovery input validation', () => {
  // Checks normal radius/filter inputs and coordinate conversion.
  test('U4-01 accepts a five-mile upcoming discovery query', async t => {
    const input = plainToInstance(NearbyQuery, { latitude: '41', longitude: '-80', radius: '5', category: 'Social', time: 'upcoming' });
    const errors = await validate(input);
    assert.equal(errors.length, 0);
    assert.equal(input.radius, 5);
    assert.equal(input.time, 'upcoming');
    t.diagnostic(JSON.stringify({ id: 'U4-01', actual: errors.length, expected: 0 }));
  });

  // Checks the inclusive upper search-radius boundary.
  test('U4-02 accepts the maximum radius of 50 miles', async t => {
    const input = plainToInstance(NearbyQuery, { latitude: 41, longitude: -80, radius: 50 });
    const errors = await validate(input);
    assert.equal(errors.length, 0);
    assert.equal(input.radius, 50);
    t.diagnostic(JSON.stringify({ id: 'U4-02', actual: errors.length, expected: 0 }));
  });

  // Checks that a radius just above the limit fails specifically on radius.
  test('U4-03 rejects a radius of 50.01 miles', async t => {
    const errors = await validate(plainToInstance(NearbyQuery, { latitude: 41, longitude: -80, radius: 50.01 }));
    assert.equal(errors.length, 1);
    assert.equal(errors[0].property, 'radius');
    assert.equal(errors[0].constraints.max, 'radius must not be greater than 50');
    t.diagnostic(JSON.stringify({ id: 'U4-03', actual: errors[0].constraints.max, expected: 'radius must not be greater than 50' }));
  });
});

