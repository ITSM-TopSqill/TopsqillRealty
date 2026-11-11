import { describe, expect, it } from "vitest";
import { frameTimes, parseScenes } from "../worker/video-scenes";
import { assertOwnVideo, videoChannel } from "../src/common/video-owner";

const fakeFetch = (author: string) => (async () => ({ url: "", status: 200, contentType: "application/json", body: Buffer.from(JSON.stringify({ author_name: author, author_url: `https://www.youtube.com/@${author}` })) })) as never;

describe("uploaded walkthrough videos", () => {
  it("looks at evenly spaced moments", () => {
    expect(frameTimes(60)).toHaveLength(10);
    expect(frameTimes(10)).toHaveLength(4);
    expect(frameTimes(600)).toHaveLength(12);
    expect(frameTimes(60).every((t, i, a) => t > 0 && t < 60 && (i === 0 || t > a[i - 1]))).toBe(true);
  });
  it("keeps the AI's scenes clean", () => {
    const s = parseScenes('```json\n{"branded": true, "scenes": [{"room": "living room", "caption": "Subtle wall texture", "line": "Panelled walls on 99acres."}, {"room": "Garage", "caption": "", "line": ""}]}\n```', [3, 9]);
    expect(s).toEqual({ branded: true, items: [{ t: 3, room: "Living room", caption: "Subtle wall texture", line: "Panelled walls." }] });
    expect(parseScenes("no json here", [1])).toBeNull();
  });
  it("refuses videos from a portal's own channel", async () => {
    await expect(assertOwnVideo("https://youtube.com/shorts/abc", fakeFetch("99_Acres"))).rejects.toThrow(/99_Acres/);
    await expect(assertOwnVideo("https://youtube.com/shorts/abc", fakeFetch("Ravi Homes Noida"))).resolves.toBeUndefined();
    expect(await videoChannel("https://youtu.be/x", (async () => { throw new Error("offline"); }) as never)).toBeNull();
  });
});
