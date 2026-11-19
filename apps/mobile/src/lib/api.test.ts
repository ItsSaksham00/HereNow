
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

  // TEST 1: Valid JPEG photo
  test("accepts a valid JPEG photo", () => {
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
  });

  // TEST 2: Empty photo
  test("rejects an empty photo", () => {
    const file = new Blob([], {
      type: "image/jpeg",
    });

    const photo = {
      uri: "file:///empty.jpg",
      file,
      mimeType: "image/jpeg",
    } as any;

    expect(() => photoForm(photo)).toThrow(
      "This photo is empty or unavailable. Please choose it again."
    );
  });

  // TEST 3: Boundary condition - exactly 6 MB
  test("rejects a photo exactly 6 MB in size", () => {
    const file = new Blob(
      [new Uint8Array(6 * 1024 * 1024)],
      { type: "image/jpeg" }
    );

    const photo = {
      uri: "file:///boundary.jpg",
      file,
      mimeType: "image/jpeg",
    } as any;

    expect(() => photoForm(photo)).toThrow(
      "Choose a photo smaller than 6 MB."
    );
  });

});
