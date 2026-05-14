import type { Preview } from "@storybook/react";
import "../src/styles/tailwind.css";

const preview: Preview = {
    parameters: {
        backgrounds: {
            default: "dark",
            values: [{ name: "dark", value: "#1a1a2e" }],
        },
    },
};

export default preview;
