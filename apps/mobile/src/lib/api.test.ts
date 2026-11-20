import { describe, expect, jest, test } from '@jest/globals';

jest.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
    },
  },
}));

jest.mock("expo/fetch", () => ({
  fetch: jest.fn(),
}));

jest.mock("expo-file-system", () => ({
  File: jest.fn(),
}));

import { photoForm } from "./api";

describe("photoForm Unit Tests", () => {

  // Checks that a nonempty JPEG-typed file becomes a form part.
  test("U2-01 accepts a valid JPEG photo", () => {
    const file = new Blob(
      [new Uint8Array(2048)],
      { type: "image/jpeg" }
    );

    const photo = {
      uri: "file:///event.jpg",
      file,
      mimeType: "image/jpeg",
    } as any;

    const actual = photoForm(photo);

    expect(actual).toBeInstanceOf(FormData);
    expect(actual.has("photo")).toBe(true);
    console.log(JSON.stringify({ id: "U2-01", actual: actual.has("photo"), expected: true }));
  });

  // Checks that an empty file is rejected.
  test("U2-02 rejects an empty photo", () => {
    const file = new Blob([], {
      type: "image/jpeg",
    });

    const photo = {
      uri: "file:///empty.jpg",
      file,
      mimeType: "image/jpeg",
    } as any;

    let message = "";
    try {
      photoForm(photo);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("This photo is empty or unavailable. Please choose it again.");
    console.log(JSON.stringify({ id: "U2-02", actual: message, expected: "This photo is empty or unavailable. Please choose it again." }));
  });

  // Checks that the inclusive 6 MiB size limit is accepted.
  test("U2-03 accepts a photo exactly 6 MiB in size", () => {
    const file = new Blob(
      [new Uint8Array(6 * 1024 * 1024)],
      { type: "image/jpeg" }
    );

    const photo = {
      uri: "file:///boundary.jpg",
      file,
      mimeType: "image/jpeg",
    } as any;

    const actual = photoForm(photo);

    expect(actual).toBeInstanceOf(FormData);
    const size = (actual.get("photo") as Blob).size;
    expect(size).toBe(6 * 1024 * 1024);
    console.log(JSON.stringify({ id: "U2-03", actual: size, expected: 6 * 1024 * 1024 }));
  });

});
