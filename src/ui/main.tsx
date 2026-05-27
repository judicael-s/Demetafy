import { render } from "solid-js/web";
import "./app.css";
import App from "./App";
import { installDevLogging } from "./lib/devlog";
import { applyTheme, resolveTheme } from "./lib/theme";

if (import.meta.env.DEV) installDevLogging();

// Apply the effective theme (explicit override, else OS preference) pre-paint.
applyTheme(resolveTheme());

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root element");

render(() => <App />, root);

if (import.meta.env.DEV) console.log("demetafy ui booted");
