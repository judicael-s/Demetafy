import { describe, expect, it } from "vitest";
import { summarizeFacebookArchiveEntries, validateFacebookArchiveCompleteness } from "./facebook-import-gate";

describe("Facebook import gate", () => {
  it("flags media-only Facebook parts as partial because no taxonomy JSON is present", () => {
    const summary = validateFacebookArchiveCompleteness([
      "your_facebook_activity/messages/inbox/thread/photos/photo_1.jpg",
      "your_facebook_activity/messages/inbox/thread/videos/video_1.mp4",
    ]);

    expect(summary).toEqual({
      ok: false,
      reason: "missing_taxonomy_json",
      taxonomyJsonCount: 0,
      messageJsonCount: 0,
    });
  });

  it("accepts a merged Facebook archive once the metadata/taxonomy part is present", () => {
    const summary = validateFacebookArchiveCompleteness([
      "your_facebook_activity/messages/inbox/thread/photos/photo_1.jpg",
      "your_facebook_activity/messages/inbox/thread/message_1.json",
      "personal_information/personal_information/facebook_profile_information.json",
    ]);

    expect(summary).toEqual({
      ok: true,
      taxonomyJsonCount: 2,
      messageJsonCount: 1,
    });
  });

  it("summarizes entry counts for progress/errors without reading large files", () => {
    expect(
      summarizeFacebookArchiveEntries([
        "your_facebook_activity/posts/your_posts_1.json",
        "your_facebook_activity/messages/inbox/thread/message_1.json",
        "your_facebook_activity/messages/inbox/thread/photos/photo_1.jpg",
        "README.txt",
      ]),
    ).toEqual({
      entryCount: 4,
      jsonCount: 2,
      taxonomyJsonCount: 2,
      messageJsonCount: 1,
    });
  });
});
