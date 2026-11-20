// Additional regression coverage, excluded from the final 18-case assignment.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { test, describe, before, after } = require('node:test');
const { PostsService } = require('../dist/posts/posts.service');
const service = new PostsService({}); // These two validation methods do not use a database.
const publication = new Date('2026-11-18T15:00:00.000Z');
const originalLifetime = process.env.POST_LIFETIME_HOURS;
before(() => { process.env.POST_LIFETIME_HOURS = '4'; });
after(() => {
  if (originalLifetime === undefined) delete process.env.POST_LIFETIME_HOURS;
  else process.env.POST_LIFETIME_HOURS = originalLifetime;
});
describe('U2 - activityExpiration: scheduling and lifetime', () => {
  // Checks the four-hour lifetime of an activity starting at publication.
  test('U2-01 expires a current activity four hours after publication', t => {
    const actual = service.activityExpiration('2026-11-18T15:00:00.000Z', publication);
    assert.equal(actual, '2026-11-18T19:00:00.000Z');
    t.diagnostic(JSON.stringify({ id: 'U2-01', actual, expected: '2026-11-18T19:00:00.000Z' }));
  });

  // Checks that a future start moves expiration beyond publication day.
  test('U2-02 keeps a future activity until its start plus four hours', t => {
    const actual = service.activityExpiration('2026-12-01T12:00:00.000Z', publication);
    assert.equal(actual, '2026-12-01T16:00:00.000Z');
    t.diagnostic(JSON.stringify({ id: 'U2-02', actual, expected: '2026-12-01T16:00:00.000Z' }));
  });

  // Checks rejection when the activity's original lifetime ends exactly now.
  test('U2-03 rejects a start whose four-hour lifetime has just ended', t => {
    let actual;
    assert.throws(() => service.activityExpiration('2026-11-18T11:00:00.000Z', publication), error => {
      actual = error.getStatus();
      return actual === 400 && error.message.includes('already be expired');
    });
    t.diagnostic(JSON.stringify({ id: 'U2-03', actual, expected: 400 }));
  });
});

describe('U4 - validatePhoto: activity photo input', () => {
  // Checks the JPEG signature accepted by the current validation method.
  test('U4-01 accepts a small JPEG-signature buffer', t => {
    const file = { mimetype: 'image/jpeg', size: 4, buffer: Buffer.from([255, 216, 255, 0]) };
    assert.equal(service.validatePhoto(file), undefined);
    t.diagnostic(JSON.stringify({ id: 'U4-01', actual: 'accepted', expected: 'accepted' }));
  });

  // Checks that the six-mebibyte size limit is inclusive.
  test('U4-02 accepts a JPEG-signature buffer exactly 6 MiB in size', t => {
    const buffer = Buffer.alloc(6 * 1024 * 1024);
    buffer.set([255, 216, 255]);
    assert.equal(service.validatePhoto({ mimetype: 'image/jpeg', size: buffer.length, buffer }), undefined);
    t.diagnostic(JSON.stringify({ id: 'U4-02', actual: 'accepted at 6291456 bytes', expected: 'accepted at 6291456 bytes' }));
  });

  // Checks that a JPEG MIME type cannot hide an invalid file signature.
  test('U4-03 rejects a forged JPEG with a text buffer', t => {
    const buffer = Buffer.from('not a photo');
    let actual;
    assert.throws(() => service.validatePhoto({ mimetype: 'image/jpeg', size: buffer.length, buffer }), error => {
      actual = error.message;
      return error.getStatus() === 400 && actual === 'The photo does not match its image format';
    });
    t.diagnostic(JSON.stringify({ id: 'U4-03', actual, expected: 'The photo does not match its image format' }));
  });
});
