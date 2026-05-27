import { describe, expect, it } from "vitest";
import { detectArchiveType } from "./archive-detect.js";

describe("detectArchiveType", () => {
  it("classifies an Instagram archive by its activity prefix", () => {
    expect(detectArchiveType(["your_instagram_activity/saved/saved_posts.json"])).toBe("instagram");
  });

  it("classifies an Instagram archive by its profile-info file", () => {
    expect(
      detectArchiveType([
        "personal_information/personal_information/instagram_profile_information.json",
      ]),
    ).toBe("instagram");
  });

  it("classifies a Facebook archive by its activity prefix", () => {
    expect(detectArchiveType(["your_facebook_activity/posts/your_posts_1.json"])).toBe("facebook");
  });

  it("classifies a Facebook archive by its profile-info file", () => {
    expect(
      detectArchiveType([
        "personal_information/personal_information/facebook_profile_information.json",
      ]),
    ).toBe("facebook");
  });

  it("prefers Instagram when both signatures are present", () => {
    expect(
      detectArchiveType([
        "your_facebook_activity/posts/your_posts_1.json",
        "your_instagram_activity/saved/saved_posts.json",
      ]),
    ).toBe("instagram");
  });

  it("returns unknown for an empty archive", () => {
    expect(detectArchiveType([])).toBe("unknown");
  });

  it("returns unknown when no Meta signature matches", () => {
    expect(detectArchiveType(["README.txt", "data/random.json"])).toBe("unknown");
  });
});
