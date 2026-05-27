import type { JSX } from "solid-js";

export type IconName =
  | "home"
  | "profile"
  | "saved"
  | "dms"
  | "stories"
  | "reposts"
  | "posts"
  | "albums"
  | "connections"
  | "settings"
  | "search";

const PATHS: Record<IconName, JSX.Element> = {
  home: <path d="M4 12l8-8 8 8M6 10v10h12V10" />,
  profile: (
    <>
      <circle cx="12" cy="9" r="3.5" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  saved: <path d="M6 4h12v16l-6-4-6 4z" />,
  dms: <path d="M4 5h16v11H8l-4 3z" />,
  stories: <circle cx="12" cy="12" r="8.5" />,
  reposts: <path d="M5 8h11a3 3 0 0 1 3 3M5 8l3-3M5 8l3 3M19 16H8a3 3 0 0 1-3-3m16 3l-3-3m3 3l-3 3" />,
  posts: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  albums: <path d="M5 5h14v14H5zM8 8h8M8 12h8M8 16h5" />,
  connections: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.8a3 3 0 0 1 0 5.6M16.5 19a5.5 5.5 0 0 0-2.8-4.8" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4.5v-2M12 21.5v-2M4.5 12h-2M21.5 12h-2M6.7 6.7 5.3 5.3M18.7 18.7l-1.4-1.4M17.3 6.7l1.4-1.4M5.3 18.7l1.4-1.4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
};

export function Icon(props: { name: IconName; class?: string }): JSX.Element {
  return (
    <svg
      class={props.class ?? "h-5 w-5"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {PATHS[props.name]}
    </svg>
  );
}
