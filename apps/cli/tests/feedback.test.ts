import { keccak256, toBytes, zeroHash } from "viem";
import { expect, test } from "vite-plus/test";
import {
  emptyFeedbackUri,
  formatScore,
  resolveFeedbackDocument,
  toFeedbackUri,
} from "../src/lib/feedback.ts";
import { CliError } from "../src/utils/errors.ts";

test("the feedback URI round-trips through base64", () => {
  const document = { jobId: "3", comment: "Fast and accurate" };

  const { uri } = toFeedbackUri(document);
  expect(uri.startsWith("data:application/json;base64,")).toBe(true);

  const decoded = JSON.parse(
    Buffer.from(uri.slice("data:application/json;base64,".length), "base64").toString("utf8"),
  );
  expect(decoded).toEqual(document);
});

test("the feedback hash commits to the exact JSON bytes", () => {
  const document = { comment: "Fast and accurate" };

  expect(toFeedbackUri(document).hash).toBe(keccak256(toBytes(JSON.stringify(document))));
});

test("score-only feedback uses an empty URI and the zero hash", () => {
  expect(emptyFeedbackUri.uri).toBe("");
  expect(emptyFeedbackUri.hash).toBe(zeroHash);
});

test("resolveFeedbackDocument returns null without --data or --file", async () => {
  expect(await resolveFeedbackDocument({})).toBeNull();
});

test("resolveFeedbackDocument passes a --data object through", async () => {
  expect(await resolveFeedbackDocument({ data: { comment: "Great" } })).toEqual({
    comment: "Great",
  });
});

test("resolveFeedbackDocument rejects --data combined with --file", async () => {
  await expect(
    resolveFeedbackDocument({ data: { comment: "Great" }, file: "review.json" }),
  ).rejects.toThrow(CliError);
});

test("resolveFeedbackDocument rejects non-object --data", async () => {
  await expect(resolveFeedbackDocument({ data: ["not", "an", "object"] })).rejects.toThrow(
    CliError,
  );
});

test("resolveFeedbackDocument rejects a missing file", async () => {
  await expect(resolveFeedbackDocument({ file: "/nonexistent/review.json" })).rejects.toThrow(
    CliError,
  );
});

test("formatScore keeps integers and trims fractions to one decimal", () => {
  expect(formatScore(90)).toBe("90");
  expect(formatScore(87.5)).toBe("87.5");
  expect(formatScore(87.56)).toBe("87.6");
});
