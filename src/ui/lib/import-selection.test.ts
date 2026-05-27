import { describe, expect, it } from "vitest";
import { metaExportGroupId, prepareArchiveSelection } from "./import-selection";

describe("prepareArchiveSelection", () => {
  it("keeps a single zip as a one-part import", () => {
    expect(prepareArchiveSelection("/tmp/instagram.zip")).toEqual({
      ok: true,
      paths: ["/tmp/instagram.zip"],
      partCount: 1,
      label: "instagram.zip",
      needsConfirmation: false,
    });
  });

  it("accepts and sorts all selected parts from the same Facebook export", () => {
    const result = prepareArchiveSelection([
      "C:/Users/example/Downloads/facebook-alexrivera-22_05_2026-ktoDXkpN.zip",
      "C:/Users/example/Downloads/facebook-alexrivera-22_05_2026-0Ba5Lu9X.zip",
    ]);

    expect(result).toEqual({
      ok: true,
      paths: [
        "C:/Users/example/Downloads/facebook-alexrivera-22_05_2026-0Ba5Lu9X.zip",
        "C:/Users/example/Downloads/facebook-alexrivera-22_05_2026-ktoDXkpN.zip",
      ],
      partCount: 2,
      label: "facebook-alexrivera-22_05_2026 (2 parts)",
      needsConfirmation: true,
    });
  });

  it("rejects mixed Facebook export groups", () => {
    expect(
      prepareArchiveSelection([
        "/tmp/facebook-alex-22_05_2026-one.zip",
        "/tmp/facebook-other-22_05_2026-two.zip",
      ]),
    ).toEqual({
      ok: false,
      title: "Mixed archive parts",
      body: "Choose zip parts from a single Meta export only. These files appear to belong to different exports.",
    });
  });

  it("accepts and sorts all parts from the same Instagram export (big-profile multi-part)", () => {
    const result = prepareArchiveSelection([
      "/d/instagram-example_user-2026-05-14-zzz.zip",
      "/d/instagram-example_user-2026-05-14-aaa.zip",
    ]);
    expect(result).toEqual({
      ok: true,
      paths: [
        "/d/instagram-example_user-2026-05-14-aaa.zip",
        "/d/instagram-example_user-2026-05-14-zzz.zip",
      ],
      partCount: 2,
      label: "instagram-example_user-2026-05-14 (2 parts)",
      needsConfirmation: true,
    });
  });

  it("rejects files that aren't named like multi-part Meta export parts", () => {
    expect(prepareArchiveSelection(["/tmp/photos.zip", "/tmp/backup-2024.zip"])).toEqual({
      ok: false,
      title: "Can't combine those files",
      body: "Multiple selection is for the parts of one Meta export, named like facebook-yourname-date-*.zip or instagram-yourname-date-*.zip. Pick a single zip, or every part of one export.",
    });
  });

  it("rejects a Facebook part mixed with an Instagram part (different exports)", () => {
    expect(
      prepareArchiveSelection([
        "/tmp/facebook-alex-22_05_2026-aaa.zip",
        "/tmp/instagram-alex-2026-05-14-bbb.zip",
      ]),
    ).toEqual({
      ok: false,
      title: "Mixed archive parts",
      body: "Choose zip parts from a single Meta export only. These files appear to belong to different exports.",
    });
  });
});

describe("metaExportGroupId", () => {
  it("returns the shared group id for FB parts regardless of order or random suffix", () => {
    expect(
      metaExportGroupId([
        "C:/Users/example/Downloads/facebook-alexrivera-22_05_2026-ktoDXkpN.zip",
        "C:/Users/example/Downloads/facebook-alexrivera-22_05_2026-0Ba5Lu9X.zip",
      ]),
    ).toBe("facebook-alexrivera-22_05_2026");
  });

  it("derives the group id from a single conforming path too", () => {
    expect(metaExportGroupId(["/d/instagram-example_user-2026-05-14-yailYno5.zip"])).toBe(
      "instagram-example_user-2026-05-14",
    );
  });

  it("returns null when parts belong to different groups (caller falls back)", () => {
    expect(
      metaExportGroupId([
        "/tmp/facebook-alex-22_05_2026-aaa.zip",
        "/tmp/facebook-other-22_05_2026-bbb.zip",
      ]),
    ).toBeNull();
  });

  it("returns null for a non-conforming name", () => {
    expect(metaExportGroupId(["/tmp/photos.zip"])).toBeNull();
    expect(metaExportGroupId([])).toBeNull();
  });
});
