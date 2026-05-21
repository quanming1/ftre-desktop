// Vite resolves these imports to correct asset URLs at build time
import githubDarkUrl from "highlight.js/styles/github-dark.min.css?url";
import githubLightUrl from "highlight.js/styles/github.min.css?url";

const LINK_ID = "hljs-theme-link";

export function setHljsTheme(resolved: "light" | "dark"): void {
    const href = resolved === "dark" ? githubDarkUrl : githubLightUrl;

    let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
    if (!link) {
        link = document.createElement("link");
        link.id = LINK_ID;
        link.rel = "stylesheet";
        document.head.appendChild(link);
    }
    link.href = href;
}
